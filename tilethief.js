#!/usr/bin/env node

/* get node modules */
var stream = require("stream");
var path = require("path");
var http = require("http");
var fs = require("fs");

/* get npm modules */
var commander = require("commander");
var lrufiles = require("lru-files");
var request = require("request");
var express = require("express");
var tracer = require("tracer");
var color = require("cli-color");
var async = require("async");

/* read package */
var pkg = require(path.resolve(__dirname, "package.json"));

/* command line arguments */
commander
	.version(pkg.version)
	.option("-f, --flush", "flush cache")
	.option("-v, --verbose", "be verbose", function(v,total){ return total+=1; }, 0)
	.option("-c, --config <file>", "config file")
	.parse(process.argv);

/* logger */
var logger = (function(){
	/* set log level according to verbosity */
	switch (commander.verbose) {
		case 0: var _level = "warn"; break;
		case 1: var _level = "info"; break;
		default: var _level = "debug"; break;
	}
	/* set colors on tty only */
	if (process.stdout.isTTY) {
		return new tracer.colorConsole({
			format: [
				color.xterm(199).bgXterm(235)("["+pkg.name+"]"),
				color.xterm(204)("{{timestamp}}"),
				"{{message}}"
			].join(" "),
			level: _level,
			dateformat : "yyyy-mm-dd HH:MM:ss"
		});
	} else {
		return new tracer.console({
			format: "["+pkg.name+"] {{timestamp}} {{message}}",
			level: _level,
			dateformat : "yyyy-mm-dd HH:MM:ss"
		});
	}
})();

/* find config file and require it */
if (commander.config) {
	var _configfile = path.resolve(process.cwd(), commander.config);
	if (fs.existsSync(_configfile)){
		var config = require(_configfile);
	} else {
		logger.error("config file not found");
		process.exit();
	}
} else {
	var _configfile = path.resolve(__dirname, "config.js");
	if (fs.existsSync(_configfile)){
		var config = require(_configfile);
	} else {
		logger.error('config file not found');
		process.exit();
	}
}

/* check if backend url is provides */
if (config.hasOwnProperty("backend-url") && typeof config["backend-url"] === "string") {
	request.get({
		url: config["backend-url"],
		json: true
	}, function(err, resp, data){
		if (err) return logger.error("could not load backend url", config["backend-url"]);
		if (resp.statusCode !== 200) return logger.error("could not load backend url %s", config["backend-url"]);
		if (typeof data !== "object") return logger.error("could not load backend url %s", config["backend-url"]);
		
		/* repace backends with remote data */
		if (!config.hasOwnProperty("backends") || typeof config.backends !== "object") config.backends = {};
		for (backend in data) config.backends[backend] = data[backend];
		if (commander.verbose) logger.info("loaded %d backends from %s", Object.keys(data).length, config["backend-url"]);
	});
}

/* setup generic async queue */ //FIXME: use this
var queue = async.queue(function(task, callback) { 
	task.fun(function(err, data){
		task.callback(err, data);
		callback();
	});
}, (config.connections||23));

/* cache */
if (commander.verbose >= 2) config.cache.debug = true;
var cache = new lrufiles(config.cache);
if (commander.flush) cache.purge(function(err){
	if (err) return logger.error("could not flush cache", err);
	if (commander.verbose) logger.info("flushed cache");
});

/* initialize express */
var app = express();

/* configure express */
app.set("trust proxy", config.app.proxied);
app.set("env", config.app.env);

/* own x-powered-by header middleware */
app.use(function(req, res, next){
	res.setHeader('X-Powered-By', (pkg.name+"/"+pkg.version));
	next();
});

/* tile bound helpers */
var _tile_lon = function(x,z){
	return (x/Math.pow(2,z)*360-180);
};

var _tile_lat = function (y,z){
	var n=Math.PI-2*Math.PI*y/Math.pow(2,z);
	return (180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))));
};

/* check bounding box */
var _check_bbox = function(z, x, y, bbox) {
	/* check for valid bbox, otherwise allow */
	if (!bbox || !(bbox instanceof Array) || bbox.length !== 4) return true;
	/* check bbox */
	if (_tile_lon(x+1,z) < bbox[0]) return false;
	if (_tile_lat(y,z) < bbox[1]) return false;
	if (_tile_lon(y,z) > bbox[2]) return false;
	if (_tile_lat(y+1,z) > bbox[3]) return false;
	/* everything is fine */
	return true;
};

/* generate backend url */
var _backend_url = function(backend, z, x, y) {

	/* get backend */
	var _backend = config["backends"][backend];

	/* get url from backend */
	var _url = _backend.url;

	/* check for subdomains */
	if (_url.match(/\{s\}/) && _backend.hasOwnProperty("sub") && (_backend.sub instanceof Array) && _backend.sub.length > 0) {
		_url = _url.replace(/\{s\}/g, _backend.sub[Math.floor(Math.random() * _backend.sub.length)]);
	}

	/* replace url variabeles and return */
	return _url.replace(/\{x\}/g, x).replace(/\{y\}/g, y).replace(/\{z\}/g, z);

};

/* error tile helper */
var default_image = fs.readFileSync(path.resolve(__dirname, config["default-image"]));

/* route for 404 images */
app.get('/404.png', function(req, res){
	res.status(404);
	res.type("image/png");
	res.send(default_image);
});

/* serve tile */
app.get('/:backend/:z/:x/:y.:ext', function(req,res){
	
	/* check if extension is allowed et al */
	if (config["allowed-extensions"].indexOf(req.params.ext) < 0) return res.send(500);
	
	/* check if backend exists */
	if (!config.backends.hasOwnProperty(req.params.backend)) return res.send(500);
	
	/* check if backend allows extension */
	if (config.backends[req.params.backend].hasOwnProperty("filetypes") && (config.backends[req.params.backend].filetypes instanceof Array) && config.backends[req.params.backend].filetypes.indexOf(req.params.ext) < 0) return res.send(500);
	
	/* check if zoom level is within backends allowed range */
	if (config.backends[req.params.backend].hasOwnProperty("zoom") && (config.backends[req.params.backend].zoom instanceof Array) && (req.params.z < config.backends[req.params.backend].zoom[0] || req.params.z > config.backends[req.params.backend].zoom[1])) return res.redirect('/404.png');
	
	/* check if boundaries are within backends allowed bounding box */
	if (config.backends[req.params.backend].hasOwnProperty("boundaries") && (config.backends[req.params.backend].boundaries instanceof Array) && config.backends[req.params.backend].boundaries && !_check_bbox(req.params.z, req.params.x, req.params.y, config.backends[req.params.backend].boundaries)) return res.redirect('/404.png');

	var _tile_file = path.join(req.params.backend, req.params.z, req.params.x, req.params.y+'.'+req.params.ext);

	if (cache.check(_tile_file, function(exists){
		if (exists) {
			// FIXME: set headers
			cache.stream(_tile_file).pipe(res);
		} else {
			var _tile_url = _backend_url(req.params.backend, req.params.z, req.params.x, req.params.y);
			// FIXME: put this in queue
			request.get(_tile_url).on('response', function(resp){
				if (resp.statusCode === 200 && /^image\//.test(resp.headers["content-type"])) { // FIXME: check length and headers
					var pass = new stream.PassThrough;
					cache.add(_tile_file, pass, function(err, filename){
						// FIXME: better logging
						if (err) console.error("[tilethief] cache error writing:", _tile_file, err);
						if (commander.verbose) console.error("[tilethief] cached:", _tile_file);
					})
					// FIXME: set headers
					this.pipe(res);
					this.pipe(pass);
				} else {
					// FIXME: send concrete tile
					res.redirect('/404.png');
				}
			});
		}
	}));
	
});

/* index page */
if (config.hasOwnProperty("redirect-url") && typeof config["redirect-url"] === "string") {
	app.get('/', function(req, res) {
		res.redirect(config["redirect-url"]);
	});
} else {
	/* show simple index page */
	app.get('/', function(req, res) {
		res.send('<html><head><title>Ready</title></head><body bgcolor="white"><center><h1>Ready</h1></center><hr><center>'+(pkg.name+"/"+pkg.version)+'</center></body></html>');
	});
}

/* default http response */
app.all('*', function(req, res){
	res.redirect('/');
});

/* make express listen */
if (config.app.hasOwnProperty("socket") && typeof config.app.socket === "string") {
	/* listen at socket */	
	var mask = process.umask(0);
	if (fs.existsSync(config.listen.socket)) {
		logger.info("unlinking old socket");
		fs.unlinkSync(config.listen.socket);
	}
	app._server = app.listen(config.app.socket, function() {
		if (mask) {
			process.umask(mask);
			var mask = null;
		}
		if (commander.verbose) logger.info("listening on socket %s", config.app.socket);
	});
} else if (config.app.hasOwnProperty("hostname") && typeof config.app.hostname === "string") {
	/* listen at hostname and port */	
	app._server = app.listen((parseInt(config.app.port,10) || 46000), config.app.hostname, function(){
		if (commander.verbose) logger.info("listening on tcp %s:%d", config.app.hostname, (parseInt(config.app.port,10) || 46000));
	});
} else {
	/* listen at port only */
	app._server = app.listen((parseInt(config.app.port,10) || 46000), function(){
		if (commander.verbose) logger.info("listening on tcp *:%d", (parseInt(config.app.port,10) || 46000));
	});
}

/* gracefully shutdown on exit */
process.on("exit", function () {
	app._server.close(function() {
		logger.info("server stopped listening. goodbye.")
	});
});

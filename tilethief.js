#!/usr/bin/env node

/* get node modules */
var fs = require("fs");
var path = require("path");
var http = require("http");

/* get npm modules */
var request = require("request");
var express = require("express");
var async = require("async");

/* get config */
var config = require(__dirname+"/config.js");

/* initialize express */
var app = express();

/* configure express */
app.set('port', process.env.PORT || config.port || 8080);
app.set('hostname', process.env.HOSTNAME || config.hostname || 'localhost');

/* load default image */
var default_image = fs.readFileSync(path.resolve(__dirname, config["default-image"]));

/* setup async queue */
var queue = async.queue(function(t, callback) { 
	t(callback);
}, 23);

/* rekursive directory creation */
var mkdirp = function(dir, callback) {
	var _dir = path.resolve(dir);
	fs.exists(_dir, function(exists){
		if (exists) {
			callback(null);
		} else {
			mkdirp(path.dirname(_dir), function(err){
				if (err) {
					callback(err);
				} else {
					fs.mkdir(_dir, function(err){
						if (err && err.code === 'EEXIST') {
							callback(null);
						} else {
							callback(err);
						}
					});
				}
			});
		}
	});
};

/* generate backend url */
var get_backend_url = function(params) {

	/* get url from backend */
	var _url = config["backends"][params.backend].url;

	/* check for subdomains */
	if (_url.match(/\{s\}/) && "sub" in config["backends"][params.backend] && Object.prototype.toString.call(config["backends"][params.backend]["sub"]) === '[object Array]' && config["backends"][params.backend]["sub"].length > 0) {
		_url = _url.replace(/\{s\}/g, config["backends"][params.backend]["sub"][Math.floor(Math.random() * config["backends"][params.backend]["sub"].length)]);
	}

	/* replace url variabeles and return */
	return _url.replace(/\{x\}/g, params.x).replace(/\{y\}/g, params.y).replace(/\{z\}/g, params.z);

};

/* resolve local tile path */
var get_tile_file = function(params) {
	return path.resolve(__dirname, config["tiles"], params.backend, params.z, params.x, params.y+'.'+params.ext);
}

/* get the tile from storage or fetch ad cache */
var get_tile = function(params, callback){
	
	var tile_file = get_tile_file(params);

	/* check if tile exists and has more than zero bytes */
	fs.exists(tile_file, function(e){		
		if (e) {
			
			/* check if file size is greater than zero bytes */
			fs.stat(tile_file, function(err, stat){
				if (!err && stat.size > 0) {
					/* everything seems fine */
					callback(null, tile_file);
				} else {
					/* unlink file and refetch */
					fs.unlink(tile_file, function(err){
						queue.push(function(_callback){
							fetch_tile(params, function(err,data){
								callback(err, data);
								_callback();
							});
						});
					});
				}
			});
		} else {
			
			/* fetch */
			queue.push(function(_callback){
				fetch_tile(params, function(err,data){
					callback(err, data);
					_callback();
				});
			});
		}
	});
};

/* fetch tile via http */
var fetch_tile = function(params, callback) {
	
	var tile_file = get_tile_file(params);
	var tile_url = get_backend_url(params);

	mkdirp(path.dirname(tile_file), function (err) {
		if (err) {
			console.error("[tilethief] Could not create directory", path.dirname(tile_file), err);
			return callback(err);
		}

		/* get head to check if a tile is retrievable */
		request.head(tile_url, function (err, resp, data) {
			if (err || resp.statusCode !== 200 || !(resp.headers["content-type"].match(/^image\//))) {
				// console.error("[Tilethief] Could not fetch tile from backend", tile_url);
				return callback(new Error('Could not fetch tile from backend'));
			}
		
			/* create write stream for cache file */
			var ws = fs.createWriteStream(tile_file);

			/* create scoped error object */
			var error = null;
		
			ws.on('close', function (err) {
				error = error || err;
				if (error) {
					console.error("[tilethief] could not fetch tile from backend", tile_url);
					callback(error);
				} else {
					/* ckeck if file size is more than zero bytes */
					fs.stat(tile_file, function(err, stat){
						if (!err && stat.size > 0) {
							/* everything seems fine */
							callback(null, tile_file);
						} else {
							/* unlink file and refetch */
							fs.unlink(tile_file, function(err){
								callback(new Error("[tilethief] server sent empty tile"));
							});
						}
					});
				}
			});

			request(tile_url).on('error', function(err){
				error = err;
				ws.end();
			}).on('end',function () {
				ws.end();
			}).pipe(ws);

		});
		
	});
	
};

/* tile request */
app.get('/:backend/:z/:x/:y.:ext', function (req, res) {
	
	if (!config["allowed-extensions"].indexOf(req.params.ext) < 0) {
		res.send(500);
		return;
	}
	
	if (!(req.params.backend in config["backends"])) {
		res.status(200);
		res.type("image/png");
		res.send(default_image);
		return;
	}
	
	/* check zoom level */
	if (("zoom" in config["backends"][req.params.backend]) && config["backends"][req.params.backend].zoom && (req.params.z < config["backends"][req.params.backend]["zoom"][0] || req.params.z > config["backends"][req.params.backend]["zoom"][1])) {
		res.status(200);
		res.type("image/png");
		res.send(default_image);
		return;
	}
	
	/* FIXME: check boundaries */
	
	/* serve file */
	get_tile(req.params, function(err, file){
		if (err) return res.status(200).type("image/png").send(default_image);
		res.status(200).sendfile(file);
	});
	
});

app.get('/', function (req, res) {
	res.redirect(config["redirect_url"]);
});

/* startup express server server */
http.createServer(app).listen(app.get('port'), app.get('hostname'), function(){
	console.log('tilethief listening on '+app.get('hostname')+':'+app.get('port'));
});

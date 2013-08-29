#!/usr/bin/env node

/* get modules */
var fs = require("fs");
var path = require("path");
var http = require("http");
var request = require("request");
var express = require("express");

/* get config */
var config = require(__dirname+"/config.js");

/* initialize express */
var app = express();

/* configure express */
app.set('port', process.env.PORT || config.port || 8080);
app.set('hostname', process.env.HOSTNAME || config.hostname || 'localhost');

/* load default image */
var default_image = fs.readFileSync(path.resolve(__dirname, config["default-image"]));

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

var get_backend_url = function(params) {

	/* get url from backend */
	var _url = config["backends"][params.backend].url;

	/* check for subdomains */
	if ("sub" in config["backends"][params.backend]) {
		_url = _url.replace(/\{s\}/g, config["backends"][params.backend]["sub"][Math.floor(Math.random() * config["backends"][params.backend]["sub"].length)]);
	}

	/* replace url variabeles and return */
	return _url.replace(/\{x\}/g, params.x).replace(/\{y\}/g, params.y).replace(/\{z\}/g, params.z);

};

var fetch = function(){};

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
	
	var tile_file = path.resolve(__dirname, config["tiles"], req.params.backend, req.params.z, req.params.x, req.params.y+'.'+req.params.ext);
	
	fs.exists(tile_file, function(e){
		
		if (e) {
			/* serve saved tile */
			res.status(200);
			res.sendfile(tile_file)
			return;
		} else {
			
			/* mkdirp for local file */
			mkdirp(path.dirname(tile_file), function(err){
				
				if (err) {
				
					/* log error */
					console.error("could not create directory", path.dirname(tile_file), err.toString());

					/* send default image */
					res.status(200);
					res.type("image/png");
					res.send(default_image);
					return;
				
				}
				
				/* retrieve file from backend */
				var tile_url = get_backend_url(req.params);

				/* fixme: reduce load for the backend server */

				request.head(tile_url, function(err, resp, data){
					
					if (err || resp.statusCode !== 200 || !(resp.headers["content-type"].match(/^image\//))) {
						
						/* log error */
						console.error("could not fetch tile from backend", tile_url);

						/* send default image */
						res.status(200);
						res.type("image/png");
						res.send(default_image);
						return;
						
					}
					
					/* send tile to client */
					request(tile_url).pipe(res);
					
					/* make copy of tile for cache */
					request(tile_url).pipe(fs.createWriteStream(tile_file));
					
				});

				
			});
			
			
		}
		
	});
	
});

app.get('/', function (req, res) {
	res.redirect(config["redirect_url"]);
});

/* startup express server server */
http.createServer(app).listen(app.get('port'), app.get('hostname'), function(){
	console.log('tilethief listening on '+app.get('hostname')+':'+app.get('port'));
});


/*

headers: 
   { 'access-control-allow-origin': '*',
     'cache-control': 'max-age=86400, public,stale-while-revalidate=86400,stale-if-error=86400',
     'content-type': 'image/jpeg',
     expires: 'Fri, 30 Aug 2013 18:39:06 GMT',
     server: 'ATS/3.2.0',
     'content-length': '1650',
     'accept-ranges': 'bytes',
     date: 'Thu, 29 Aug 2013 18:41:28 GMT',
     via: '1.1 varnish',
     age: '143',
     connection: 'keep-alive',
     'x-served-by': 'cache-am71-AMS',
     'x-cache': 'MISS',
     'x-cache-hits': '0',
     'x-timer': 'S1377801687.828431368,VS0,VE230' },

*/
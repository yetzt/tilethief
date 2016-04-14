
// node modules
var cluster = require("cluster");
var path = require("path");
var url = require("url");

//npm modules
var ellipse = require("ellipse");
var queue = require("queue");
var debug = require("debug")("tilethief");
var mime = require("mime");
var nsa = require("nsa");

// local modules
var tilecache = require(path.resolve(__dirname, "tilecache.js"));

function tilethief(config){
	if (!(this instanceof tilethief)) return new tilethief(config);
	var self = this;
	self.config = config;
	self.maps = {};
	self.stopping = false;
	
	if (cluster.isMaster) self.startMaster(function(err){
		if (err) debug("init error: %s", err) || process.exit(1);
	});
	
	if (cluster.isWorker) self.startWorker(function(err){
		if (err) debug("worker %d init error: %s", cluster.worker.id, err) || process.exit(1);
	});
	
	return this;
};

// add map
tilethief.prototype.addMap = function(mapid, map, fn){
	var self = this;
	
	(function(){
	
		// check for map url
		if (!map.hasOwnProperty("url") || typeof map.url !== "string" || map.url === "") return debug("addMap: missing map url") || fn(new Error("Missing map URL"));
	
		// check map url protocol
		if (["http:","https:"].indexOf(url.parse(map.url).protocol) < 0) return debug("addMap: Invalid protocol in map url '%s'", map.url) || fn(new Error("Invalid protocol in map URL"));

		// check if sub is required and given
		if (map.url.indexOf("{s}") >= 0 && ((!map.hasOwnProperty("sub")) || !(map.sub instanceof Array) || map.sub.length < 1)) return debug("addMap: Missing subdomain list for map URL") || fn(new Error("Missing subdomain list for map URL"));

		// check for parameters
		if (map.url.indexOf("{z}") < 0) return debug("addMap: Missing z parameter in map URL '%s'", map.url) || fn(new Error("Missing z parameter in map URL"));
		if (map.url.indexOf("{x}") < 0) return debug("addMap: Missing x parameter in map URL '%s'", map.url) || fn(new Error("Missing x parameter in map URL"));
		if (map.url.indexOf("{y}") < 0) return debug("addMap: Missing y parameter in map URL '%s'", map.url) || fn(new Error("Missing y parameter in map URL"));

		// create zoom levels
		map.zooms = self.range(map.zoom);
		if (map.zooms === false) return debug("addMap: Invalid zoom levels: %j", map.zoom) || fn(new Error("Invalid zoom levels"));

		map.bounds = false;
		if (map.hasOwnProperty("bbox")) {
			if (!(map.bbox instanceof Array) || map.bbox.length !== 4 || !self.checkLatLng([map.bbox[0],map.bbox[1]]) || !self.checkLatLng([map.bbox[2],map.bbox[3]]))  return debug("addMap: Invalid bonding box: %j", map.bbox) || fn(new Error("Invalid bounding box"));

			// generate limits
			map.bounds = {};
			map.zooms.filter(function(z){ return z.toString(); }).forEach(function(z){
				map.bounds[z] = { s: self.lat(map.bbox[0],z), e: self.lng(map.bbox[1],z), n: self.lat(map.bbox[2],z), w: self.lng(map.bbox[3],z) };
			});

		}

		// FIXME: check ext, sub, retina, max_*?

		// call back with config
		fn(null, {
			bbox: map.bounds,
			ext: map.ext,
			zmin: map.zoom[0],
			zmax: map.zoom[1],
			tiles: tilecache({
				url: map.url,
				dir: path.resolve(self.config.dir, mapid),
				max_files: map.max_files, 
				max_size: map.max_size, 
				max_age: map.max_age, 
				max: map.max, 
				sub: map.sub, 
				retina: map.retina,
			}, function(msg){
				msg.map = mapid;
				self.broadcast(msg);
			})
		});

	})();
	
	return this;
};

// convert lng to tile x
tilethief.prototype.lng = function(lng,z){
	return (Math.floor((lng+180)/360*Math.pow(2,z)));
};

// convert lat to tile y
tilethief.prototype.lat = function(lat,z){
	return (Math.floor((1-Math.log(Math.tan(lat*Math.PI/180) + 1/Math.cos(lat*Math.PI/180))/Math.PI)/2 *Math.pow(2,z)));
};

tilethief.prototype.range = function(z){
	if (z.length !== 2) return false;
	if (z[0] > z[1]) return false;
	var zooms = [];
	for (var i = z[0]; i <= z[1]; i++) zooms.push(i);
	return zooms;
}

// register signal handlers
tilethief.prototype.signalHandlers = function(fn){
	var self = this;

	// SIGTERM
	process.on("SIGTERM", function(){
		debug("caught SIGTERM");
		self.stopMaster(function(){
			debug("goodbye");
			process.exit(0);
		});
	});

	// SIGINT
	process.on("SIGINT", function(){
		debug("caught SIGINT");
		self.stopMaster(function(){
			debug("*drops mic*");
			process.exit(0);
		});
	});

	// SIGHUP
	process.on("SIGHUP", function(){
		debug("caught SIGHUP");
		self.reloadMaster(function(){
			debug("tilethief reloaded");
		});
	});
	
	debug("signal handlers ready");
	fn(null);
	
	return this;
}

// check coordinate pair
tilethief.prototype.checkLatLon = tilethief.prototype.checkLatLng = function(latlng) {
	if (!(latlng instanceof Array) || latlng.length !== 2) return false;
	if (!(typeof latlng[0] === "number") || latlng[0] < -90 || latlng[0] > 90) return false;
	if (!(typeof latlng[1] === "number") || latlng[1] < -180 || latlng[1] > 180) return false;
	return true;
};

// check if a tile meets specifications
tilethief.prototype.check = function(map, z, x, y, ext, fn){
	var self = this;

	(function(){

		// check map identifier
		if (!/^[A-Za-z0-9\-\_]+$/.test(map)) return debug("check: invalid map '%s'", map) || fn(new Error("Invalid map identifier"));
		if (!self.maps.hasOwnProperty(map)) return debug("check: unknown map '%s'", map) || fn(new Error("Unknown map identifier"));

		// check extension
		if (self.maps[map].ext instanceof Array && self.maps[map].ext.length > 0 && self.maps[map].ext.indexOf(ext) < 0) return debug("check: disallowed extension '%s'", ext) || fn(new Error("Disallowed extension"));
		if (typeof self.maps[map].ext === "string" && self.maps[map].ext !== "" && ext !== self.maps[map].ext) return debug("check: disallowed extension '%s'", ext) || fn(new Error("Disallowed extension"));

		// check zoom level
		var zf = parseFloat(z,10);
		if (zf%1!==0) return debug("check: invalid zoom float %d ", zf) || fn(new Error("Disallowed zoom factor"));
		if (zf < self.maps[map].zmin) return debug("check: invalid zoom %d < %d", zf, self.maps[map].zmin) || fn(new Error("Disallowed zoom factor"));
		if (zf > self.maps[map].zmax) return debug("check: invalid zoom %d > %d", zf, self.maps[map].zmax) || fn(new Error("Disallowed zoom factor"));

		// check bbox
		if (self.maps[map].bbox) {
			var zs = z.toString();
			if (x < self.maps[map].bbox[zs].e || x > self.maps[map].bbox[zs].w) return debug("check: invalid tile x %d <> [%d-%d@%d]", x, self.maps[map].bbox[zs].e, self.maps[map].bbox[zs].w, z) || fn(new Error("Disallowed tile x"));
			if (y < self.maps[map].bbox[zs].n || y > self.maps[map].bbox[zs].s) return debug("check: invalid tile y %d <> [%d-%d@%d]", y, self.maps[map].bbox[zs].n, self.maps[map].bbox[zs].s, z) || fn(new Error("Disallowed tile y"));
		}

		// that was easy.
		fn(null);

	})();
	
	return this;
};

// gracefully stop sending heartbeats
tilethief.prototype.stopHeartbeat = function(fn){
	var self = this;

	// check if heartbeat is running
	if (!self.hasOwnProperty("heartbeat") || !(self.heartbeat instanceof nsa)) return debug("heartbeat not running") || fn(null);
	
	// perform stop
	debug("heartbeat stop");
	self.heartbeat.end(function(err){
		if (err) return debug("heartbeat failed to stop: %s", err) || fn(err);
		debug("heartbeat stopped");
		self.heartbeat = null;
		fn(null);
	});
	return this;
};

// start sending heartbeats
tilethief.prototype.startHeartbeat = function(fn){
	var self = this;

	// check if heartbeat is configured
	if (!self.config.hasOwnProperty("nsa") || typeof self.config.nsa !== "string" || self.config.nsa === "") return debug("heartbeat not configured") || fn(null);
	if (self.hasOwnProperty("heartbeat") && self.heartbeat instanceof nsa) return debug("heartbeat already running") || fn(new Error("heartbeat already running"));
	
	// perform start
	debug("heartbeat start");
	self.heartbeat = new nsa({
		server: self.config.nsa,
		service: "tilethief",
		interval: "10s"
	}).start(function(err){
		if (err) return debug("heartbeat failed to start: %s", err) || fn(err);
		debug("heartbeat started");
		fn(null);
	});
	return this;
};

// start master process
tilethief.prototype.startMaster = function(fn){
	var self = this;
	
	// start signal handlers
	self.signalHandlers(function(){});
	
	// unlink old socket
	if (self.config.listen.hasOwnProperty("socket") && typeof self.config.listen.socket === "string") {
		if (fs.existsSync(self.config.listen.socket)) {
			debug("unlinking old socket %s", self.config.listen.socket);
			if (!fs.unlinkSync(self.config.listen.socket)) {
				console.error("could not unlink old socket");
				process.exit(1);
			}
		}
	};
	
	// spawn workers
	self.workers = [];
	for (var i = 0; i < self.config.threads; i++) self.workers.push(cluster.fork());

	cluster.on("message", function(msg){
		debug("received message from cluster: %j", msg);
		if (msg.type === "broadcast") self.broadcast(msg);
	});

	// respawn worker on exit, if not in stopping mode
	cluster.on("exit", function(worker) {
		// remove from workers
		self.workers = self.workers.filter(function(w){
			return (w.id !== worker.id);
		});

		if (self.stopping || worker.suicide) return;
		debug("worker %d died in a tragic accident.", worker.id);
		debug("autocreating new worker for terminated %d", worker.pid) || self.workers.push(cluster.fork());
	});
	
	// start heartbeat server
	self.startHeartbeat(function(){});
	
	return this;
};

// stop master process
tilethief.prototype.stopMaster = function(fn){
	var self = this;
	
	// switch to stopping mode
	self.stopping = true;
	
	// stop all the things
	var q = queue();
	
	// terminate all workers
	self.workers.forEach(function(worker){
		q.push(function(next){
			debug("asking worker %s to terminate", worker.id);
			worker.disconnect();
			var wait = setTimeout(function(){
				worker.kill();
			}, 2000);
			worker.on('disconnect', function(){
				debug("worker %s terminated on request", worker.id);
				clearTimeout(wait);
				next();
			});
		});
	});
	
	// stop heartbeat
	q.push(function(next){
		self.stopHeartbeat(function(err){
			next();
		});
	});
	
	q.start(function(err){
		self.stopping = false;
		fn(err);
	});
	
	return this;
};

// terminate and respawn all workers
tilethief.prototype.reloadMaster = function(fn){
	var self = this;
	
	// switch to stopping mode
	self.stopping = true;
	
	// stop all the things
	var q = queue();

	// make new worker object
	var workers = self.workers;
	self.workers = [];
	
	// spawn new workers before terminating old ones. should result in no downtime
	for (var i = 0; i < self.config.threads; i++) q.push(function(next){
		self.workers.push(cluster.fork());
		next();
	});
	
	// terminate all workers
	workers.forEach(function(worker){
		q.push(function(next){
			worker.disconnect();
			var wait = setTimeout(function(){
				worker.kill();
			}, 2000);
			worker.on('disconnect', function(){
				clearTimeout(wait);
				next();
			});
		});
	});
	
	// run through queue
	q.start(function(err){
		self.stopping = false;
		fn(err);
	});
	
	return this;
};

// start worker process
tilethief.prototype.startWorker = function(fn){
	var self = this;
				
	// configure maps
	Object.keys(self.config.maps).forEach(function(mapid){
		debug("configuring map '%s'", mapid);
		self.addMap(mapid, self.config.maps[mapid], function(err, map){
			if (err) debug("unable to add map '%s': %s", mapid, err);
			self.maps[mapid] = map;
		});
	});
	
	// listen to incoming messages
	process.on('message', function(msg) { 
		debug("worker %d received message %j", cluster.worker.id, msg);
		self.handleMessage(msg);
	});
		
	// create instance of webserver
	var app = self.app = ellipse();
	
	// configure index route
	app.get("/", function(req,res){
		if (self.config.redirect) return res.redirect(self.config.redirect);
		res.set("content-type","text/html").send("<html><head><title></title></head><body><h1>Tilthief</h1><p>is running.</p></h1></html>");
	});

	// configure map route
	app.get("/:map([A-Za-z0-9\\-\\_\\.]+)/:z(\\d+)/:x(\\d+)/:y(\\d+):r(@2x)?.:ext([A-Za-z0-9]+)", function(req,res){
		
		// check if map exists
		var map = req.params.map.toLowerCase();
		var ext = req.params.ext.toLowerCase();
		var ret = ((req.params.r)?true:false);
		var x = parseInt(req.params.x,10);
		var y = parseInt(req.params.y,10);
		var z = parseInt(req.params.z,10);
		if (!self.maps.hasOwnProperty(map)) return debug("requested invalid map: %s", map) || res.status(404).end();
		
		// check requested tile
		self.check(map, z, x, y, ext, function(err){
			if (err) return res.status(404).end();
			
			// get tile
			self.maps[map].tiles.get(z, x, y, ext, ret, function(err,stream){
				if (err) return res.status(404).end();

				// set status and content type
				res.status(200);
				res.setHeader("Content-Type", mime.lookup(ext));
				res.setHeader("X-Worker", cluster.worker.id);

				// pipe tile to response
				stream.pipe(res);
			});
			
		});
		
	});

	// ping route
	/* FIXME: set atime of tile.
	app.get("/ping/:map([a-z0-9\\-\\_\\.]+)/:z(\\d+)/:x(\\d+)/:y(\\d+):r((@2x)?).:ext([a-z0-9]+)", function(req,res){
		res.send("ok");
	});
	*/

	app.get("*", function(req,res){
		res.status(404).end();
	});

	app.all("*", function(req,res){
		res.status(405).end();
	});
	
	// listen
	if (self.config.listen.hasOwnProperty("socket")) {
		self.server = app.listen(self.config.listen.socket, function(err) {
			if (err) return fn(err);
			// change socket mode
			fs.chmod(self.config.listen.socket, 0777, function(err){
				if (err) return fn(err);
				debug("worker %d listening on %s", cluster.worker.id, self.config.listen.socket);
				return fn(null);
			});
		});
	} else if (self.config.listen.hasOwnProperty("port") && self.config.listen.hasOwnProperty("host")) {
		self.server = app.listen(self.config.listen.port, self.config.listen.host, function(err){
			if (err) return fn(err);
			debug("worker %d listening on %s:%d", cluster.worker.id, self.config.listen.host, self.config.listen.port);
			return fn(null);
		});
	} else if (self.config.listen.hasOwnProperty("port")) {
		self.server = app.listen(self.config.listen.port, function(err){
			if (err) return fn(err);
			debug("worker %d listening on *:%d", cluster.worker.id, self.config.listen.port);
			return fn(null);
		});
	} else {
		return fn(new Error("invalid listen configuration"));
	}
		
	return this;
};

// this is thilethief radio
tilethief.prototype.broadcast = function(msg){
	var self = this;
	(function(){
		if (cluster.isWorker) {
			msg.type = "broadcast";
			msg.from = cluster.worker.id;
			process.send(msg);
		} else if (cluster.isMaster) self.workers.forEach(function(worker){
			// don't send to source worker
			if (worker.id === msg.from) return;
			worker.send(msg);
		});
	})();
	return this;
};

// broadcast message handling
tilethief.prototype.handleMessage = function(msg){
	var self = this;
	(function(){
		if (msg.type !== "broadcast") return;
		if (cluster.isWorker) {
			if (["add","touch","remove","save"].indexOf(msg.action) >= 0) {
				if (!self.maps.hasOwnProperty(msg.map)) return debug("message for unknown map '%s'", msg.map);
				return self.maps[msg.map].tiles.message(msg);
			}
			switch (msg.action) {
				default:
					debug("received unknown message: %j", msg);
				break;
			}
		} else if (cluster.isMaster) {
			self.broadcast(msg);
		}
	})();
	return this;
};

module.exports = tilethief;
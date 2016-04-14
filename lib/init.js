
// node modules
var fs = require("fs");	
var os = require("os");
var url = require("url");
var path = require("path");	

// npm modules
var minimist = require("minimist");
var mkdirp = require("mkdirp");	
var debug = require("debug")("tilethief:init");
var dur = require("dur");

function init(){
	if (!(this instanceof init)) return new init();
	var self = this;

	// config defaults
	self.defaults = { pid: null, dir: null, threads: Math.max(Math.floor(os.cpus().length/2),1), redirect: false, socket: false, listen: { host: "localhost", port: 3000, default: true }, nsa: false, maps: {} };

	return this;
};

// load configuration
init.prototype.load = function(argv, fn){ 
	var self = this;
	
	// check for arguments
	if (!argv) return fn(new Error("no arguments given"));

	// keep argv
	self.argv = argv;

	// default config
	self.config = {};
	
	// determine config file
	self.configfile = (!argv.hasOwnProperty("config") || typeof argv.config !== "string" || argv.config === "") ? path.resolve((process.env.USERPROFILE || process.env.HOME),'.tilethief/config.json') : path.resolve(process.cwd(), argv.config);
	debug("config file is %s", self.configfile);
	
	self.readconfig(function(err,data){
		if (err) return fn(err);
	
		var config = self.defaults;
	
		// override config defaults from config file
		if (data.hasOwnProperty("pid") && typeof data.pid === "number") config.pid = data.pid;
		if (data.hasOwnProperty("threads") && typeof data.threads === "number") config.threads = data.threads;
		if (data.hasOwnProperty("dir") && typeof data.dir === "string" && data.dir !== "") config.dir = data.dir;
		if (data.hasOwnProperty("redirect") && typeof data.redirect === "string" && data.redirect !== "") config.redirect = data.redirect;
		if (data.hasOwnProperty("listen") && (data.listen.hasOwnProperty("port") || data.listen.hasOwnProperty("socket"))) config.listen = data.listen;
		if (data.hasOwnProperty("nsa") && typeof data.nsa === "string" && data.nsa !== "") config.nsa = data.nsa;
		if (data.hasOwnProperty("maps") && typeof data.maps === "object" && Object.keys(data.maps).length > 0) Object.keys(data.maps).forEach(function(m){ if(data.maps.hasOwnProperty(m)) config.maps[m] = data.maps[m]; });
		
		// keep config
		self.config = config;

		// call back
		return fn(null, config);
	
	});
	
	return this;
};

// parse and apply configuration
init.prototype.configure = function(argv, fn){ 
	var self = this;
	
	// check for arguments
	if (!argv) return fn(new Error("no arguments given"));
	
	// keep argv
	self.argv = argv;
	
	// default config
	self.config = {};
	
	// determine config file
	self.configfile = (!argv.hasOwnProperty("config") || typeof argv.config !== "string" || argv.config === "") ? path.resolve((process.env.USERPROFILE || process.env.HOME),'.tilethief/config.json') : path.resolve(process.cwd(), argv.config);
	debug("config file is %s", self.configfile);
	
	// determine command
	self.command = (argv._.length > 0) ? argv._[0] : "";

	// determine mapid if given
	self.mapid = (argv.hasOwnProperty("map") && typeof argv.map === "string" && argv.map !== "") ? argv.map : (argv._.length > 1) ? argv._[1] : null;
	if (!/^[a-z0-9\-\_\.]+$/.test(self.mapid)) {
		debug("invalid map id '%s'", self.mapid);
		self.mapid = null;
	}
	
	self.getconfig(function(err){
		if (err) return fn(err);
		fn(null, self.config);
	});
	
	return this;
};

// laod config and update with command line parameters
init.prototype.getconfig = function(fn){
	var self = this;

	self.readconfig(function(err,data,severe){
		if (err && severe) return fn(err);
		
		var config = self.defaults;
				
		// override config defaults from config file
		if (data.hasOwnProperty("pid") && typeof data.pid === "number") config.pid = data.pid;
		if (data.hasOwnProperty("threads") && typeof data.threads === "number") config.threads = data.threads;
		if (data.hasOwnProperty("dir") && typeof data.dir === "string" && data.dir !== "") config.dir = data.dir;
		if (data.hasOwnProperty("redirect") && typeof data.redirect === "string" && data.redirect !== "") config.redirect = data.redirect;
		if (data.hasOwnProperty("listen") && (data.listen.hasOwnProperty("port") || data.listen.hasOwnProperty("socket"))) config.listen = data.listen;
		if (data.hasOwnProperty("nsa") && typeof data.nsa === "string" && data.nsa !== "") config.nsa = data.nsa;
		if (data.hasOwnProperty("maps") && typeof data.maps === "object" && Object.keys(data.maps).length > 0) Object.keys(data.maps).forEach(function(m){ if(data.maps.hasOwnProperty(m)) config.maps[m] = data.maps[m]; });
		
		// overrride config with parameters
		if (self.argv.hasOwnProperty("pid") && typeof self.argv.pid === "string" && self.argv.pid !== "") config.pid = parseInt(self.argv.pid,10);
		if (self.argv.hasOwnProperty("threads") && typeof self.argv.threads === "string" && self.argv.threads !== "") config.threads = parseInt(self.argv.threads,10);
		if (self.argv.hasOwnProperty("dir") && typeof self.argv.dir === "string" && self.argv.dir !== "") config.dir = path.resolve(process.cwd(), self.argv.dir);
		if (self.argv.hasOwnProperty("listen") && typeof self.argv.listen === "string" && self.argv.listen !== "") {
			if (/^[a-z0-9\.\-\:]+:[0-9]+$/.test(self.argv.listen)){
				var listen = self.argv.listen.split(/:/g);
				config.listen = {
					host: listen[0],
					port: parseInt(listen[1],10)
				};
			} else if (/^[0-9]+$/.test(self.argv.listen)) {
				config.listen = {
					port: parseInt(self.argv.listen,10)
				};
			}
		}
		if (self.argv.hasOwnProperty("socket") && typeof self.argv.socket === "string" && self.argv.socket !== "") config.listen = { socket: path.resolve(process.cwd(), self.argv.socket) };
		if (self.argv.hasOwnProperty("redirect") && typeof self.argv.redirect === "string" && self.argv.redirect !== "") config.redirect = self.argv.redirect;
		if (self.argv.hasOwnProperty("nsa") && typeof self.argv.nsa === "string" && /^udp[46]:\/\/([a-z0-9\-\.]+|[0-9\.]+|\[][a-f0-9\:]+\]):[0-9]+(\?.*)?$/.test(self.argv.nsa)) config.nsa = self.argv.nsa;
				
		// warn about ingnored optional parameters
		if (self.argv.pid && !config.pid) debug("ignoring --pid %s", self.argv.pid);
		if (self.argv.threads && !config.threads) debug("ignoring --threads %s", self.argv.threads);
		if (self.argv.listen && config.listen.default) debug("ignoring --listen %s", self.argv.listen);
		if (self.argv.socket && config.listen.default) debug("ignoring --socket %s", self.argv.socket);
		if (self.argv.nsa && !config.nsa) debug("ignoring --nsa %s", self.argv.nsa);
		if (self.argv.redirect && !config.redirect) debug("ignoring --redirect %s", self.argv.redirect);
		
		// check required parameters
		if (config.dir === null) return fn(new Error("Data directory not specified. Please use --dir"));
		
		// manage maps 
		if (self.mapid) {
			switch (self.command) {
				case "remove":
				case "delete":
					if (!self.mapid) {
						debug("no map specified");
						break;
					}
					if (!config.maps.hasOwnProperty(self.mapid)) {
						debug("map does not exist: %s", self.mapid);
						break;
					}
					delete config.maps[self.mapid];
				break;
				case "add":
				case "update":
				case "start":
				case "stop":
				case "reload":
				case "init":
				case "config":
				case "":
					var map = (config.maps.hasOwnProperty(self.mapid)) ? config.maps[self.mapid] : {};

					// check url parameter
					if ((self.argv.hasOwnProperty("url")) && (typeof self.argv.url === "string") && (self.argv.url !== "")) {
						if ((["http:","https:"].indexOf(url.parse(self.argv.url).protocol) >= 0) && (self.argv.url.indexOf("{x}") >= 0) && (self.argv.url.indexOf("{y}") >= 0) && (self.argv.url.indexOf("{z}") >= 0)) {
							map.url = self.argv.url;
						} else {
							debug("ignoring invalid --url %s", self.argv.url);
						}
					}
					if (!map.hasOwnProperty("url")) {
						fn(new Error("no --url for map "+self.mapid));
						break;
					}

					// check optional parameters
					if (self.argv.hasOwnProperty("sub") && typeof self.argv.sub === "string" && self.argv.sub !== "") {
						map.sub = self.argv.sub.split(/,/g);
					}
					if (self.argv.hasOwnProperty("ext") && typeof self.argv.ext === "string" && self.argv.ext !== "") {
						map.ext = self.argv.ext.split(/,/g).map(function(v){ return v.toLowerCase(); }).filter(function(v){ return /^[a-z0-9]+$/.test(v); });
					}
					if (self.argv.hasOwnProperty("max") && typeof self.argv.max === "string" && /^[0-9]+$/.test(self.argv.max)) {
						map.max = Math.max(parseInt(self.argv.max,10), 20); // its just polite to not allow an exceedig number of connections here
					}
					if (self.argv.hasOwnProperty("zoom") && typeof self.argv.zoom === "string" && /^[0-9]+(\-[0-9]+)?$/.test(self.argv.zoom)) {
						map.zoom = self.argv.zoom.split(/\-/g).map(function(v){ return parseInt(v,10); });
						if (map.zoom.length === 1) map.zoom.push(map.zoom[0]);
					}
					if (self.argv.hasOwnProperty("bbox") && typeof self.argv.bbox === "string" && self.argv.bbox !== ""){
						if (!/^(\-?[0-9]+(\.[0-9]+))(,\-?[0-9]+(\.[0-9]+)){3}$/.test(self.argv.bbox)) {
							debug("invalid --bbox %s", self.argv.bbox);
							break;
						}
						var _bbox = self.argv.bbox.split(/,/g).map(function(v){ return parseFloat(v); });
						if (_bbox[0] > _bbox[2] || _bbox[1] > _bbox[3] || _bbox[0] < -90 || _bbox[1] < -180 || _bbox[2] > 90 || _bbox[3] > 180) {
							debug("out of bounds --bbox %s", self.argv.bbox);
							break;
						}
						map.bbox = _bbox;
					}
					if (self.argv.hasOwnProperty("keep") && ((typeof self.argv.keep === "string" && self.argv.keep !== "") || self.argv.keep instanceof Array)) {
						((typeof self.argv.keep === "string") ? [self.argv.keep] : self.argv.keep).forEach(function(k){
							
							// check for number of files
							if (/^[0-9]+$/.test(k)) {
								map.max_files = parseInt(k,10);
								return;
							}

							// check for file size
							if (/^[0-9]+\s*[kmgt]?b$/.test(k.toLowerCase())) {
								map.max_size = k.toLowerCase().replace(/\s+/g,'');
								return;
							}
							
							// check for age
							if (dur(k.toLowerCase()) !== null) {
								map.max_age = k.toLowerCase();
								return;
							}
							
							debug("did not recognize --keep %s", k);
							
						});
					}
					if (self.argv.hasOwnProperty("retina")) {
						if (typeof self.argv.retina === "string" && self.argv.retina !== "") map.retina = self.argv.retina;
						else map.retina = false;
					}
					
					// set default options
					if (!map.hasOwnProperty("max_files")) map.max_files = 0;
					if (!map.hasOwnProperty("max_size")) map.max_size = 0;
					if (!map.hasOwnProperty("max_age")) map.max_age = 0;
					if (!map.hasOwnProperty("bbox")) map.bbox = [-90,-180.90,180];
					if (!map.hasOwnProperty("zoom")) map.zoom = [1,19];
					if (!map.hasOwnProperty("max")) map.max = 20;
					if (!map.hasOwnProperty("sub") || !(map.sub instanceof Array) || map.sub.length === 0) map.sub = [];
					if (!map.hasOwnProperty("retina")) map.retina = false;
					if (!map.hasOwnProperty("ext") || !(map.ext instanceof Array) || map.ext.length === 0) map.ext = [];
					
					config.maps[self.mapid] = map;
					
				break;
			}
		};

		// keep config
		self.config = config;
			
		// save config
		self.saveconfig(function(err){
			if (err) return debug("could not save config: %s", err.toString());
			debug("saved config to file '%s'", self.configfile);;
			return fn(null, config);
		});
		
	});

	return this;
};

// save the current config to the config file
init.prototype.saveconfig = function(fn){
	var self = this;

	self.mkdir(path.dirname(self.configfile), function(err){
		if (err) return fn(err);
		try {
			var config = JSON.stringify(self.config,null,'\t');
		} catch (err) {
			return fn(err);
		}
		
		fs.writeFile(self.configfile, config, function(err){
			if (err) return fn(err);
			return fn(null);
		});
		
	});

	return this;
};

// read the config file
init.prototype.readconfig = function(fn){
	var self = this;
	
	fs.exists(self.configfile, function(x){
		if (!x) return fn(new Error("config file does not exists"), {}, false);
		fs.readFile(self.configfile, function(err, f){
			if (err) return fn(new Error("config file not readable: "+err.toString()), {}, true);
			try {
				var data = JSON.parse(f.toString());
			} catch(err) {
				return fn(new Error("config file invalid: "+err.toString()), {}, true);
			}
			fn(null, data);
		});
	});
	
	return this;
};

// relaod the config but ignore command line
init.prototype.reload = function(fn){
	var self = this;

	self.readconfig(function(err, config){
		if (err) return fn(err);
		self.config = config;
		fn(null, config);
	});

	return this;
};

// update the pid in the config file
init.prototype.setpid = function(fn){
	var self = this;

	self.config.pid = process.pid;
	debug("pid has ben set to %d", process.pid);
	
	self.saveconfig(function(err){
		if (err) return debug("could not save config: %s", err.toString());
		debug("saved config to file '%s'", self.configfile);;
	});

	return this;
};

// create directory if need be
init.prototype.mkdir = function(configdir, fn){
	var self = this;
	fs.exists(configdir, function(x){
		if (x) return fn(null);
		mkdirp(configdir, { mode: 0755 }, function(err){
			if (err) return fn(new Error("could not create config dir: "+err.toString()));
			return fn(null);
		});
	});
	return this;
};

module.exports = init;
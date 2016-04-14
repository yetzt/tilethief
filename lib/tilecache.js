
// node modules
var stream = require("stream");

// npm modules
var request = require("request");
var debug = require("debug")("tilecache");
var cache = require("lru-files");
var async = require("async");

function tilecache(config, fn){
	if (!(this instanceof tilecache)) return new tilecache(config, fn);
	var self = this;
	
	// keep config
	self.config = config;
	
	// callback for stuff that happens
	self.handler = (typeof fn === "function") ? fn : function(){};
	
	// check config
	
	// create cache
	self.cache = new cache({
		dir: self.config.dir,
		files: (self.config.max_files || false),
		size: (self.config.max_size || false),
		age: (self.config.max_age || false),
		check: "10m",
		persist: "5m",
		cluster: true,
		onsave: function(){
			self.handler({action: "save"});
		}
	}, function(err){
		if (err) {
			self.cache = false;
			debug("disabling cache because of error: %s", err);
			return;
		}
		debug("cache initialized");
	});
	
	// prepare queue
	self.q = async.queue(function(f,n){ f(n); }, self.config.max);
	
	// FIXME: prepare limits?
	
	
	return this;
};

// default callback
tilecache.prototype.cb = function(err, f){
	if (err) debug("Error in tilecache.%s: %s", f||"?", err);
	return this;
};

// transform parameters to url
tilecache.prototype.tileurl = function(z,x,y,e,r){
	var self = this;
	try {
		var u = self.config.url
			.replace("{x}", x.toFixed(0))
			.replace("{y}", y.toFixed(0))
			.replace("{z}", z.toFixed(0))
			.replace("{s}", ((self.config.sub)&&(self.config.sub instanceof Array)&&(self.config.sub.length>0))?self.config.sub[Math.floor(Math.random()*self.config.sub.length)]:"")
			.replace("{r}", (r)?(self.config.retina||""):"")
			.replace("{e}", (e)?e:"");
	} catch (err) {
		debug("tileurl error: %s", err);
		return false;
	}
	return u;
};

// transform parameters to filename
tilecache.prototype.tilefile = function(z,x,y,e,r){
	var self = this;
	return ("{z}/{x}/{y}{r}.{e}")
	.replace("{x}", x.toFixed(0))
	.replace("{y}", y.toFixed(0))
	.replace("{z}", z.toFixed(0))
	.replace("{r}", (r)?(self.config.retina||""):"")
	.replace("{e}", (e)?e:"");
};

// get tile
tilecache.prototype.get = function(z,x,y,e,r,fn){
	var self = this;
	
	// check for callback
	if (typeof fn !== "function") return;
		
	// generate path for tile file
	var tile_file = self.tilefile(z,x,y,e,r);
		
	// fetch or get from cache
	self.cache.check(tile_file, function(exists){
		if (!exists) return self.fetch(z,x,y,e,r,fn);
		self.cache.stream(tile_file, fn);
	});
	
	return this;
};

// fetch tile from backend tile
tilecache.prototype.fetch = function(z,x,y,e,r,fn){
	var self = this;
	
	// check for callback
	if (typeof fn !== "function") return;
	
	// generate tile url
	var tile_url = self.tileurl(z,x,y,e,r);
	if (tile_url === false) return debug("inavlid tile url: %j", [z,x,y,e,r]) || fn(new Error("invalid parameters"));
	var tile_file = self.tilefile(z,x,y,e,r);
	
	// fetch with request
	self.q.push(function(done){
		debug("fetching tile '%s'", tile_url);
		request.get(tile_url).on('response', function(resp){
			done();

			// check response
			if (resp.statusCode !== 200) return debug("status code for tile '%s' is %d", tile_url, resp.statusCode) || fn(new Error("status code is not 200"));
			if (resp.headers.hasOwnProperty("content-type") && !/^image\//.test(resp.headers["content-type"])) return debug("content type for tile '%s' is %s", tile_url, resp.headers["content-type"]) || fn(new Error("content-type is not image/*"));
			if (resp.headers.hasOwnProperty("content-length") && parseInt(resp.headers["content-length"],10) === 0) return debug("content lenght for tile '%s' is 0", tile_url) || fn(new Error("content-length is 0"));
			
			// create passthrough stream for painless multiplexing
			var tilestream = new stream.PassThrough;
			var savestream = new stream.PassThrough;
			this.pipe(tilestream);
			this.pipe(savestream);

			// return stream
			fn(null, tilestream);

			// add file to cache
			self.cache.add(tile_file, savestream, function(err, f){
				if (err) return debug("could not cache file '%s': %s", tile_file, err);
				debug("added to cache: %j", self.cache.filemeta[f]);

				(function(next){
					// experimental: check if cached file has the right size, otherwise delete.
					if (resp.headers.hasOwnProperty("content-length")) {
						try {
							if (parseInt(resp.headers["content-length"],10) !== self.cache.filemeta[f].size) {
								debug("cache check failed: %d <> %d", parseInt(resp.headers["content-length"],10), self.cache.filemeta[f].size);
								self.cache.remove(f, function(err){
									if (err) return debug("could not remove cache file %s: %s", f, err) || done(false);
								});
							} else {
								next();
							}
						} catch(e){
							next();
						};
					} else {
						next();
					}
					
				})(function(){
					// send message that file was added
					self.handler({action: "add", file: f, data: self.cache.filemeta[f] });
				});
			});
		});
	});
	
	return this;
};

// receive message from tilethief
tilecache.prototype.message = function(msg){
	var self = this;
	self.cache.handle(msg);
	return this;
}

module.exports = tilecache;
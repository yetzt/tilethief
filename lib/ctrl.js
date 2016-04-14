var ps = require("piss");
var debug = require("debug")("tilethief:ctrl");

var ctrl = {
	// send SIGTERM to process
	stop: function stop(pid, fn){
		if (!pid) return fn(new Error("no pid"));
		ctrl.running(pid, function(err, running){
			if (err) return fn(err);
			if (!running) return debug("process %d is not running", pid) || fn(null);
			debug("process %d is running", pid);
			try {
				process.kill(pid, "SIGTERM");
			} catch(err) {
				return fn(err);
			}
			fn(null);
		});
		return;
	},
	// wait for process to terminate; fn(err, terminated, waiting)
	wait: function(pid, max, fn){
		if (!pid) return fn(new Error("no pid"));
		if (typeof max === "function") {
			var fn = max;
			var max = false;
		}
		var start = Date.now();
		var timer = setInterval(function(){
			ctrl.running(pid, function(err, running){

				if (err) {
					clearInterval(timer);
					return fn(err);
				};

				// has terminated?
				if (!running) {
					clearInterval(timer);
					return fn(null, true, false);
				};

				// max time reached?
				if (max && (Date.now()-start) > max) {
					clearInterval(timer);
					fn(null, false, false);
				};

				// still running
				return fn(null, false, true);

			});

		},1000);

		return;
	},
	// send SIGHUP to process
	reload: function(pid, fn){
		if (!pid) return fn(new Error("no pid"));
		ctrl.running(pid, function(err, running){
			if (err) return fn(err);
			if (!running) return fn(new Error("process not running"));
			try {
				process.kill(pid, "SIGHUP");
			} catch(err) {
				return fn(err);
			}
		});
		return;
	},
	// send SIGTERM, wait max 10 seconds to terminate, else send SIGKILL to process
	kill: function reload(pid, fn){
		if (!pid) return fn(new Error("no pid"));
		ctrl.running(pid, function(err, running){
			if (err) return fn(err);
			if (!running) return fn(null);
			
			ctrl.stop(pid, function(err){
				if (err) return fn(err);
				
				ctrl.wait(pid, 10000, function(err, terminated, waiting){
					if (err) return fn(err);
					if (waiting) return fn(null,null);
					if (terminated) return fn(null,true);
					try {
						process.kill(pid, "SIGKILL");
					} catch(err) {
						return fn(err);
					}
					fn(null, false);
					
				});
				
			});
			
		});
		return;
	},
	// check if process is running
	running: function running(pid, fn){
		if (!pid) return fn(new Error("no pid"));
		ps(pid, function(err, proc) {
			if (err) return fn(err);

			// check if there is a process for this uid
			if (!proc.pid) return fn(null, false);
			debug("there is a process with pid %d", pid);

			// check if uid is matching
			if (process.getuid && process.getuid() !== proc.uid) return debug("uid isnt matching for pid %d: %d <> %d", pid, process.getuid(), proc.uid) || fn(null, false);

			// check if command contains node and tilethief
			// i'd really like to have this tighter, but POSUX
			if (proc.cmd.indexOf("node") < 0 || proc.cmd.indexOf("tilethief") < 0) return debug("cmd isnt matching for pid %d: %s", pid, proc.cmd) || fn(null, false);
		
			// check if zombie. it's not running if it's a zombie. (just in case, really)
			if (proc.state === "z") return debug("process with pid %d is a zombie", pid, proc.cmd) || fn(null, false);

			// ok, it's running alright
			return fn(null, proc.state);
		
		});
		return;
	}
};

module.exports = ctrl;
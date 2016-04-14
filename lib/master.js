
// node modules
var fs = require("fs");	
var path = require("path");	

// npm modules
var daemon = require("daemon");
var minimist = require("minimist");
var mkdirp = require("mkdirp");	
var debug = require("debug")("tilethief");

// local modules
var init = require(path.resolve(__dirname, "init.js"));
var ctrl = require(path.resolve(__dirname, "ctrl.js"));

// parse command line arguments (taken: abcdehklmnprstuwxz avail: fgijoqvy)
var argv = minimist(process.argv.slice(2), {
	'boolean': ['help'],
	'string': ['config','dir','redirect','socket','listen','pid','nsa','threads','url','sub','zoom','bbox','keep','max','map','retina','ext'],
	'alias': {'help':'h','config':'c','dir':'d','redirect':'w','socket':'s','listen':'l','pid':'p','nsa':'n','threads':'t','url':'u','sub':'a','zoom':'z','bbox':'b','keep':'k','max':'x','map':'m','retina':'r','ext':'e'}
});

// help will always be given at hogwarts to those who ask for it
if (argv.help) {
	console.error("tilethief - a caching map tile proxy\n");
	console.error(path.basename(process.argv[1])+" [command] [options]");
	console.error("Commands:\n");
	console.error("\t"+["start",  "start the server as a daemon (default)"].join("\t"));
	console.error("\t"+["run",    "start the server inforeground mode"].join("\t"));
	console.error("\t"+["stop",   "stop the server (same as sending SIGTERM)"].join("\t"));
	console.error("\t"+["reload", "reload the server (same as sending SIGHUP)"].join("\t"));
	console.error("\t"+["restart","restart the server, killing it if need be"].join("\t"));
	console.error("\t"+["config", "set configuration parameters without reloading"].join("\t"));
	console.error("\t"+["add",    "add or update a map. url is requred on adding"].join("\t"));
	console.error("\t\t"+"add <mapname> -u <url> [-a <sub>,<sub>[,<sub>]*] [-z <min>-<max>] [-b <s>,<e>,<n>,<w>] [-k <size|time|files>] [-m <connections>]");
	console.error("\t"+["remove", "remove a map "].join("\t"));
	console.error("\t\t"+"remove <mapname>");
	console.error("")
	console.error("Global Options:\n");
	console.error("\t"+["--help     -h","show help"].join("\t"));
	console.error("\t"+["--config   -c","config file"].join("\t"));
	console.error("\t"+["--pid      -p","pid or pidfile"].join("\t"));
	console.error("")
	console.error("Configuration Options:\n");
	console.error("\t"+["--dir      -d","data dir"].join("\t")); // req
	console.error("\t"+["--socket   -s","listen on unix socket"].join("\t")); // req
	console.error("\t"+["--listen   -l","listen on [<host>:]<port>"].join("\t")); // req
	console.error("\t"+["--map      -m","<mapname> name of map to use"].join("\t"));
	console.error("\t"+["--redirect -w","<url> redirect directory requests to this url"].join("\t"));
	console.error("\t"+["--threads  -t","<n> number of worker threads"].join("\t"));
	console.error("\t"+["--nsa      -n","<udp(4|6)://host:port[?options]> nsa monitoring server (see npmjs.com/package/nsa-server)"].join("\t"));
	console.error("")
	console.error("Map Options:\n");
	console.error("\t"+["--url      -u","map url template, may contain {x}, {y}, {z}, {s}, {r}, {e}"].join("\t"));
	console.error("\t"+["             ","{x}, {y}, {z} are the maps longonal, lateral and zoom values"].join("\t"));
	console.error("\t"+["             ","{s} is a random element fomr --sub, used for distributing requests on many servers"].join("\t"));
	console.error("\t"+["             ","{e} is the file extension requested by the client"].join("\t"));
	console.error("\t"+["             ","{r} is the value of --retina when the client requests a retina tile"].join("\t"));
	console.error("\t"+["             ","example: http://{s}.maps.example/{z}/{x}/{y}{r}.{e}"].join("\t"));
	console.error("\t"+["             ","becomes: http://a.maps.example/3/2/1@2x.png"].join("\t"));
	console.error("\t"+["--retina   -r","retina url part, filled in for {r}"].join("\t"));
	console.error("\t"+["             ","example: --retina '@2x' "].join("\t"));
	console.error("\t"+["--sub      -a","subdomains to be randomly filled in for {s}, delimited by a colon"].join("\t"));
	console.error("\t"+["             ","example: --sub a,b,c "].join("\t"));
	console.error("\t"+["--ext      -e","allowed file extensions, delimited by a colon"].join("\t"));
	console.error("\t"+["             ","example: --ext png,svg "].join("\t"));
	console.error("\t"+["--max      -x","maximum number of concurrent requests to backend server"].join("\t"));
	console.error("\t"+["--zoom     -z","allowed zoom levels from <min>-<max>"].join("\t"));
	console.error("\t"+["--bbox     -b","bounding box with <south>,<west>,<north>,<east> coordinates"].join("\t"));
	console.error("\t"+["--keep     -k","caching limits"].join("\t"));
	console.error("\t"+["             ","maximum total file size: <n>kb, <n>mb or <n>gb"].join("\t"));
	console.error("\t"+["             ","maximum age of any tile: <n>s, <n>m, <n>h, <n>d or a combination thereof (ex: 5d4h3m)"].join("\t"));
	console.error("\t"+["             ","maximum number of files: <n>"].join("\t"));
	console.error("\t"+["             ","to combine use multiple -k or concatenate with colons"].join("\t"));
	console.error("")
	process.exit(0);
}

// initialize
var conf = init().configure(argv, function(err, config){
	if (err) console.error(err) || process.exit(1);

	// execute command
	switch (conf.command) {
		case "":
		case "start":
			// run as daemon
			if (ctrl.running(config.pid)) console.error("tilethief is already running with pid "+config.pid) || process.exit(1);
			var child = daemon.daemon(process.argv[1], ["run", "-c", conf.configfile]);
			console.error("started tilethief daemon with pid "+child.pid);
			process.exit();
		break;
		case "run":
			// set pid of master process
			conf.setpid();
			// run in foreground
			var tilethief = require(path.resolve(__dirname, "tilethief.js"))
			tilethief(config);
		break;
		case "stop":
			if (!config.pid) console.error("unknown pid, please specify with --pid") || process.exit(1);
			ctrl.stop(config.pid, function(err){
				if (err) return console.error("Error: "+err) || process.exit(1);
				debug("waiting for process to terminate");
				process.stderr.write("Stopping: ");
				ctrl.wait(config.pid, 10000, function(err,terminated,waiting){
					if (err) return process.stderr.write("Failed: "+err+"\n") || process.exit(1);
					if (!terminated && waiting) return process.stderr.write(". ");
					if (!terminated) return process.stderr.write("Failed\n") || process.exit(1);
					process.stderr.write("Stopped\n");
				});
			});
		break;
		case "restart":
			if (!config.pid) console.error("unknown pid, please specify with --pid") || process.exit(1);
			ctrl.stop(config.pid, function(err){
				if (err) return console.error("Error: "+err) || process.exit(1);
				debug("waiting for process to terminate");
				process.stderr.write("Stopping tilethief ");
				ctrl.wait(config.pid, 10000, function(err,terminated,waiting){
					if (waiting) return process.stderr.write(". ");
					if (!terminated) return process.stderr.write("Failed\n") || process.exit(1);
					debug("restarting");
					process.stderr.write("Stopped\n");
					console.error("Restarting")
					var child = daemon.daemon(process.argv[1], ["run", "-c", conf.configfile]);
					console.error("restarted tilethief daemon with new pid "+child.pid);
					process.exit();
				});
			});
		break;
		case "reload":
			if (!config.pid) console.error("unknown pid, please specify with --pid") || process.exit(1);
			ctrl.reload(config.pid, function(err){
				if (err) console.error("Error: "+err.toString()) || process.exit(1);
				console.error("Sent SIGHUP to "+config.pid);
			});
		break;
		case "add":
		case "update":
			if (conf.mapid) debug("updated map %s", conf.mapid);
			console.error("Configured map "+conf.mapid);
			ctrl.running(config.pid, function(err, running){
				if (running) ctrl.reload(config.pid, function(err){
					if (err) console.error("Error: "+err.toString()) || process.exit(1);
					console.error("Sent SIGHUP to "+config.pid);
				});
			});
		break;
		case "remove":
			if (conf.mapid) debug("removed map %s", conf.mapid);
			console.error("Configured map "+conf.mapid);
			ctrl.running(config.pid, function(err, running){
				if (running) ctrl.reload(config.pid, function(err){
					if (err) console.error("Error: "+err.toString()) || process.exit(1);
					console.error("Sent SIGHUP to "+config.pid);
				});
			});
		break;
		case "kill":
			if (!config.pid) console.error("unknown pid, please specify with --pid") || process.exit(1);
			process.stderr.write("Terminating: ");
			ctrl.kill(function(err, terminated){
				if (err) console.error("Error: "+err.toString()) || process.exit(1);
				if (terminated === null) process.stderr.write(". ");
				if (terminated === true) process.stderr.write("Terminated.\n");
				process.stderr.write("Failed.\n");
				process.stderr.write("Killing: ");
				ctrl.wait(config.pid, 10000, function(err,terminated,waiting){
					if (waiting) return process.stderr.write(". ");
					if (!terminated) return process.stderr.write("Failed.\n") || process.exit(1);
					process.stderr.write("Killed.\n");
					console.error("Have a nice day!")
					process.exit();
				});
			});
		break;
		case "status":
			if (!config.pid) console.error("unknown pid, please specify with --pid") || process.exit(1);
			ctrl.running(config.pid, function(err, running){
				if (err) return console.error("Error: "+err.toString()) || process.exit(1);
				if (running) return console.error("Tilethief is running with pid "+config.pid) || process.exit(0);
				console.error("Tilethief is not running.") || process.exit(2);
			});
		break;
		case "init":
		case "getconfig":
			console.log(JSON.stringify(config,null,'\t'));
			process.exit(0);
		break;
		case "config":
			debug("configuration updated.");
			process.exit(0);
		break;
		default:
			console.error("unknown command '"+conf.command+"'");
			process.exit(1);
		break;
	}
});


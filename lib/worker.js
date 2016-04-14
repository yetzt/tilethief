
// node modules
var path = require("path");

// npm modules
var minimist = require("minimist");

// local modules
var init = require(path.resolve(__dirname, "init.js"));
var tilethief = require(path.resolve(__dirname, "tilethief.js"))

// parse command line arguments
var argv = minimist(process.argv.slice(2), {'string':['config'],'alias':{'config':'c'}});

// load config and start tilethief
init().load(argv, function(err, config){
	if (err) console.error(err) || process.exit(1);
	tilethief(config);
});

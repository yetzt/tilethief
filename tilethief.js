#!/usr/bin/env node

// node modules
var path = require("path");
var cluster = require("cluster");

// run either master or worker
if (cluster.isMaster) require(path.resolve(__dirname, "lib/master.js"));
if (cluster.isWorker) require(path.resolve(__dirname, "lib/worker.js"));

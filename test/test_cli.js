var assert = require("assert");
var path = require("path");
var rmdir = require("rimraf");
var spawn = require("child_process").spawn;
var asap = require("pdenodeify");
var fs = require("fs-extra");
var treeKill = require("tree-kill");
var fileExists = require("./file_exists");

require("steal");

var find = require("./helpers").find;
var open = require("./helpers").open;

var isWin = /^win/.test(process.platform);

function kill(pid) {
	return new Promise(function(resolve){
		treeKill(pid, undefined, function(){
			resolve();
		});
	});
}

function stealToolsC(args){
	var cli = path.resolve(__dirname + "/../bin/steal");
	args = args || [];

	if(isWin) {
		args.unshift.apply(args, ["/c", "node", cli]);
		cli = "cmd";
	}

	var child = spawn(cli, args || []);
	return child;
}

function stealTools(args){
	return new Promise(function(resolve, reject){
		var error = "";
		var child = stealToolsC(args);

		child.stderr.on("data", function(data) {
			error += data.toString();
		});

		child.on("close", function(code){
			if(code === 1) {
				return reject(error ?
					new Error(error) :
					new Error("Exited with status 1")
				);
			}
			return resolve();
		});
	});
}

describe("steal-tools cli", function () {
	this.timeout(25000);

	describe("build", function () {
		describe("basics", function () {
			beforeEach(function () {
				this.cwd = process.cwd();
				process.chdir(__dirname);
			});

			afterEach(function () {
				process.chdir(this.cwd);
			});

			it("works", function () {
				return stealTools(["build", "--config", "stealconfig.js",
					"--main", "basics/basics", "--no-minify"]);
			});

			it("uses build by default", function () {
				return stealTools(["--config", "stealconfig.js",
								  "--main", "basics/basics", "--no-minify"]);
			});
		});

		describe("without --config or --main", function () {
			this.timeout(15000);

			beforeEach(function (done) {
				this.cwd = process.cwd();
				process.chdir(path.resolve(__dirname + "/npm"));

				rmdir = asap(rmdir);
				var copy = asap(fs.copy);

				rmdir(path.join(__dirname, "npm", "node_modules"))
					.then(function () {
						return rmdir(path.join(__dirname, "npm", "dist"));
					})
					.then(function () {
						return copy(
							path.join(__dirname, "..", "node_modules", "jquery"),
							path.join(__dirname, "npm", "node_modules", "jquery")
						);
					})
					.then(done, done);
			});

			afterEach(function () {
				process.chdir(this.cwd);
			});

			it("uses package.json", function (done) {
				stealTools(["--no-minify"]).then(function () {
					open("test/npm/prod.html", function (browser, close) {
						var h1s = browser.window.document.getElementsByTagName('h1');
						assert.equal(h1s.length, 1, "Wrote H!.");
						close();
					}, done);
				});
			});
		});
	});

	describe("transform", function () {
		describe("basics", function () {
			beforeEach(function (done) {
				this.cwd = process.cwd();
				process.chdir(__dirname);

				rmdir(__dirname + "/pluginify/out.js", function (error) {
					done(error);
				});
			});

			afterEach(function () {
				process.chdir(this.cwd);
			});

			it("works", function (done) {
				var options = ["transform", "-c", "stealconfig.js", "-m",
					"pluginify/pluginify", "--out", "pluginify/out.js"];

				stealTools(options).then(function () {

					open("test/pluginify/index.html", function (browser, close) {

						find(browser, "RESULT", function (result) {
							assert(result.module.es6module, "have dependeny");
							assert(result.cjs(), "cjs");
							assert.equal(result.UMD, "works", "Doesn't mess with UMD modules");
							assert.equal(result.define, undefined, "Not keeping a global.define");
							assert.equal(result.System, undefined, "Not keeping a global.System");
							close();
						}, close);

					}, done);
				});
			});
		});
	});

	describe("live-reload", function(){
		this.timeout(30000);

		beforeEach(function () {
			this.cwd = process.cwd();
			process.chdir(__dirname);
		});

		afterEach(function () {
			process.chdir(this.cwd);
		});

		var isListening = /Live-reload server listening/;

		it.skip("logs that it is listening to stderr", function(done){
			var child = stealToolsC(["live-reload", "-c", "stealconfig.js",
									"-m", "basics/basics"]);

			child.stderr.setEncoding("utf8");
			child.stderr.on("data", function(d){
				if(isListening.test(d)) {
					child.kill();
					kill(child.pid).then(function(){
					   done();
					});
				}
			});
		});

		it.skip("fails if there is another process running on the same port",
		   function(done){
			var one = stealToolsC(["live-reload", "-c", "stealconfig.js",
									"-m", "basics/basics"]);

			one.stderr.setEncoding("utf8");
			one.stderr.on("data", function(d){
				if(isListening.test(d)) {
					startSecond();
				}
			});

			function startSecond() {
				var two = stealToolsC(["live-reload", "-c", "stealconfig.js",
									"-m", "basics/basics"]);

				two.stderr.setEncoding("utf8");
				two.stderr.on("data", function(d){
					if(/Can not start live-reload/.test(d)) {
						Promise.all([
							kill(two.pid),
							kill(one.pid)
						]).then(function(){
							done();
						});
					}
				});
			}
		});
	});

	describe("export", function() {
		this.timeout(10000);

		var distPath = path.join(
			__dirname,
			"pluginifier_builder_helpers",
			"dist"
		);

		before(copyDependencies);

		describe("with --cjs", function() {
			beforeEach(function() {
				this.cwd = process.cwd();

				process.chdir(path.join(
					__dirname,
					"pluginifier_builder_helpers"
				));

				fs.removeSync(distPath);
				return stealTools(["export", "--cjs"]);
			});

			afterEach(function() {
				process.chdir(this.cwd);
			});

			it("only outputs +cjs", function() {
				assert(fs.existsSync(path.join(distPath, "cjs")),
					"it should output cjs build");

				assert(!fs.existsSync(path.join(distPath, "amd")),
					"it should not output amd");

				assert(!fs.existsSync(path.join(distPath, "global")),
					"it should not output global-js");
			});
		});

		describe("with --amd", function() {
			beforeEach(function() {
				this.cwd = process.cwd();

				process.chdir(path.join(
					__dirname,
					"pluginifier_builder_helpers"
				));

				fs.removeSync(distPath);
				return stealTools(["export", "--amd"]);
			});

			afterEach(function() {
				process.chdir(this.cwd);
			});

			it("only outputs +amd", function() {
				assert(!fs.existsSync(path.join(distPath, "cjs")),
					"it should not output cjs");

				assert(!fs.existsSync(path.join(distPath, "global")),
					"it should not output global-js");
			});
		});

		function copyDependencies(done) {
			var prmdir = asap(rmdir);
			var pcopy = asap(fs.copy);

			var srcModulesPath = path.join(__dirname, "..", "node_modules");
			var destModulesPath = path.join(
				__dirname,
				"pluginifier_builder_helpers",
				"node_modules"
			);

			prmdir(destModulesPath)
				.then(function() {
					return pcopy(
						path.join(srcModulesPath,"jquery"),
						path.join(destModulesPath, "jquery")
					);
				})
				.then(function() {
					return pcopy(
						path.join(srcModulesPath, "cssify"),
						path.join(destModulesPath, "cssify")
					);
				})
				.then(function() {
					return pcopy(
						path.join(srcModulesPath, "steal-less"),
						path.join(destModulesPath, "steal-less")
					);
				})
				.then(function() {
					return pcopy(
						path.join(srcModulesPath, "steal-css"),
						path.join(destModulesPath, "steal-css")
					);
				})
				.then(function() {
					done();
				})
				.catch(function(error) {
					done(error);
				});
		}
	});

	describe("optimize", function() {
		this.timeout(10000);

		it("works", function() {
			var cwd = process.cwd();
			var base = path.join(__dirname, "slim", "worker", "single");

			process.chdir(base);

			return asap(rmdir)(path.join(base, "dist"))
				.then(function() {
					return stealTools([
						"optimize",
						"--config", "stealconfig.js",
						"--main", "main",
						"--no-minify",
						"--target", "web", "worker"
					]);
				})
				.then(function() {
					var bundles = path.join(base, "dist", "bundles");

					return Promise.all([
						fileExists(path.join(bundles, "worker", "main.js")),
						fileExists(path.join(bundles, "web", "main.js"))
					]);
				})
				.then(function() {
					process.chdir(cwd);
				});
		});

		it("'target' should be optional", function() {
			var cwd = process.cwd();
			var base = path.join(__dirname, "slim", "worker", "single");

			process.chdir(base);

			return asap(rmdir)(path.join(base, "dist"))
				.then(function() {
					return stealTools([
						"optimize",
						"--config", "stealconfig.js",
						"--main", "main",
						"--no-minify"
					]);
				})
				.then(function() {
					var bundles = path.join(base, "dist", "bundles");
					return fileExists(path.join(bundles, "main.js"));
				})
				.then(function() {
					process.chdir(cwd);
				});
		});
	});

	it("throws if an unknown 'target' is passed in", function(done) {
		var cwd = process.cwd();
		var base = path.join(__dirname, "slim", "worker", "single");

		process.chdir(base);

		asap(rmdir)(path.join(base, "dist"))
			.then(function() {
				return stealTools([
					"optimize",
					"--config", "stealconfig.js",
					"--main", "main",
					"--no-minify",
					"--target", "foo"
				]);
			})
			.then(
				function() {
					assert(false, "command should not succeed");
				},
				function(error) {
					process.chdir(cwd);
					assert(
						/Cannot create slim build, target/.test(error.message),
						"should throw a descriptive error message"
					);
				}
			)
			.then(done, done);
	});
});

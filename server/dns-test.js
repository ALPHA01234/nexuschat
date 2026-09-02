const dns = require("dns");

dns.setServers(["8.8.8.8"]);

dns.promises.resolveSrv("_mongodb._tcp.cluster0.lfrctye.mongodb.net")
.then(console.log)
.catch(console.error);
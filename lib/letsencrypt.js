function createServer(app, settings, certificates, leSettings, log) {
    var server;

    if (settings.secure) {
        if (leSettings && (!leSettings.email || !leSettings.email) && settings.leEnabled) {
            log.error('Please specify the email address and domains to use Let\'s Encrypt certificates!');
        }

        if (leSettings && leSettings.email && leSettings.domains && settings.leEnabled) {
            var utils = require(__dirname + '/utils'); // Get common adapter utils
            var tools = require(utils.controllerDir + '/lib/tools');
            var tls   = require('tls');
            var LEX   = require('letsencrypt-express');
            LEX.debug = true;
            var leDir;

            if (leSettings.path && (leSettings.path[0] === '/' || leSettings.path.match(/^[A-Za-z]:/))) {
                leDir = leSettings.path;
            } else {
                leDir = tools.getDefaultDataDir() + (leSettings.path || 'letsencrypt');
            }

            if (!console.debug) console.debug = console.log;

            if (!fs.existsSync(leDir)) fs.mkdirSync(leDir);

            // prepare domains
            if (typeof leSettings.domains === 'string') {
                leSettings.domains = leSettings.domains.split(',');
                for (var d = leSettings.domains.length - 1; d >= 0; d++) {
                    leSettings.domains[d] = leSettings.domains[d].trim();
                    if (!leSettings.domains[d]) leSettings.domainss.splice(d, 1);
                }
            }

            var lex = LEX.create({
                configDir: leDir,
                approveRegistration: function (hostname, approve) { // leave `null` to disable automatic registration
                    if (leSettings.domains.indexOf(hostname) !== -1) { // Or check a database or list of allowed domains
                        approve(null, {
                            domains:    leSettings.domains,
                            email:      leSettings.email,
                            agreeTos:   true
                        });
                    }
                }
            });

            if (settings.leUpdate) {
                // handles acme-challenge and redirects to https
                // used for validation of requests like  http://example.com/.well-known/acme-challenge/BLABALBAL
                require('http').createServer(LEX.createAcmeResponder(lex, function redirectHttps(req, res) {
                    res.setHeader('Location', 'https://' + req.headers.host + req.url);
                    res.statusCode = 302;
                    res.end('<!-- Hello Developer Person! Please use HTTPS instead -->');
                })).listen(leSettings.lePort || 80);
            }

            var options    = JSON.parse(JSON.stringify(certificates));
            var defaultTls = tls.createSecureContext(certificates);
            var hostTls;

            options.SNICallback = function (hostname, cb) {
                if (leSettings.domains.indexOf(hostname) !== -1) {
                    if (settings.leUpdate) {
                        return lex.httpsOptions.SNICallback(hostname, cb);
                    } else {
                        if (!hostTls) {
                            // validate certificates
                            lex.letsencrypt.fetch({domains: leSettings.domains}, function (err, certInfo) {
                                if (err) {
                                    console.error(err);
                                    cb(null, defaultTls);
                                    return;
                                }
                                if (certInfo) {
                                    hostTls = tls.createSecureContext({
                                        key:  certInfo.privkey   || certInfo.key,      // privkey.pem
                                        cert: certInfo.fullchain || certInfo.cert,     // fullchain.pem (cert.pem + '\n' + chain.pem)
                                        ca:   certInfo.ca
                                    });
                                    cb(null, hostTls);
                                } else {
                                    log.error('No letsencrypt certificates found in "' + leDir + '"');
                                    cb(null, defaultTls);
                                    // do not register
                                    /*
                                    lex.letsencrypt.register({
                                        domains:    leSettings.domains,
                                        email:      leSettings.email,
                                        agreeTos:   true
                                    }, function (err, certInfo) {
                                        running = false;
                                        //console.debug("[LEX] '" + hostname + "' register completed", err && err.stack || null, certInfo);
                                        if ((!err || !err.stack) && !certInfo) {
                                            log.error((new Error('[LEX] SANITY FAIL: no error and yet no certs either')).stack);
                                        }
                                        if (certInfo) {
                                            hostTls = tls.createSecureContext({
                                                key:  certInfo.privkey   || certInfo.key,      // privkey.pem
                                                cert: certInfo.fullchain || certInfo.cert,     // fullchain.pem (cert.pem + '\n' + chain.pem)
                                                ca:   certInfo.ca
                                            });
                                        }
                                    });*/
                                }
                            });
                        } else {
                            cb(null, hostTls);
                        }
                    }
                } else {
                    cb(null, defaultTls);
                }
            };

            server.server = require('https').createServer(options, LEX.createAcmeResponder(lex, server.app));
        } else {
            server = require('https').createServer(certificates, app);
        }
    } else {
        server = require('http').createServer(app);
    }

    return server;
}

exports.createServer = createServer;
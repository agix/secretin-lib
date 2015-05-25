var express = require('express');
var app = express();
var bodyParser = require('body-parser');
var cradle = require('cradle');
var db = new(cradle.Connection)().database('secretin');
var forge = require('node-forge');
var rsa = forge.pki.rsa;
var BigInteger = forge.jsbn.BigInteger;
var redis = require('redis');
client = redis.createClient();

app.use(express.static('client'));
app.use(bodyParser.json());


function userExists(name, callback){
  db.view('users/getUser', { key: name }, function (err, doc) {
    if(err === null && typeof doc !== 'undefined' && doc.length === 1){
      callback(true, doc[0].value.res, {id: doc[0].id, rev: doc[0].value.rev});
    }
    else{
      callback(false, {});
    }
  });
}

function secretExists(title, callback){
  db.view('secrets/getSecret', { key: title }, function (err, doc) {
    if(err === null && typeof doc !== 'undefined' && doc.length === 1){
      callback(true, doc[0].value.res, {id: doc[0].id, rev: doc[0].value.rev});
    }
    else{
      callback(false, {});
    }
  });
}

function checkToken(name, token, callback){
  client.get(name, function(err, res){
    callback(res === token)
  });
}

app.get('/user/:name', function (req, res) {
  userExists(req.params.name, function(exists, user){
    if(exists){
      res.json(user);
    }
    else{
      res.writeHead(404, 'User not found', {});
      res.end();
    }
  });
});

app.get('/secret/:title', function (req, res) {
  secretExists(req.params.title, function(exists, secret){
    if(exists){
      res.json(secret);
    }
    else{
      res.writeHead(404, 'Secret not found', {});
      res.end();
    }
  });
});

app.post('/user/:name', function (req, res) {
  userExists(req.params.name, function(exists){
    if(exists){
      res.writeHead(403, 'User already exists', {});
      res.end();
    }
    else{
      var doc = {user: {}};
      doc.user[req.params.name] = req.body;
      db.save(doc, function (err, ret) {
        if(err === null && ret.ok === true){
          res.writeHead(200, 'New user saved', {});
          res.end();
        }
        else{
          console.log(err)
          res.writeHead(500, 'Unknown error', {});
          res.end();
        }
      });
    }
  });
});

app.post('/user/:name/:title', function (req, res) {
  userExists(req.params.name, function(uExists, user, metaUser){
    if(uExists){
      secretExists(req.params.title, function(sExists){
        if(sExists){
          res.writeHead(403, 'Secret already exists', {});
          res.end();
        }
        else{
          var doc = {secret: {}};

          doc.secret[req.params.title] = {
            secret: req.body.secret,
            iv: req.body.iv,
            users: [req.params.name]
          };

          user.keys[req.params.title] = {
            title: req.body.title,
            key: req.body.key,
            rights: 2
          };

          var userDoc = {user: {}};
          userDoc.user[req.params.name] = user;
          db.save(metaUser.id, metaUser.rev, userDoc, function (err, ret) {
            if(err === null && ret.ok === true){
              db.save(doc, function (err, ret) {
                if(err === null && ret.ok === true){
                  res.writeHead(200, 'New secret saved', {});
                  res.end();
                }
                else{
                  console.log(err)
                  res.writeHead(500, 'Unknown error', {});
                  res.end();
                }
              });
            }
            else{
              console.log(err)
              res.writeHead(500, 'Unknown error', {});
              res.end();
            }
          });
        }
      });
    }
    else{
      res.writeHead(404, 'User not found', {});
      res.end();
    }
  });
});

app.get('/token/:name', function (req, res) {
  userExists(req.params.name, function(exists, user){
    if(exists){

      var n = new Buffer(user.publicKey.n, 'base64');
      var e = new Buffer(user.publicKey.e, 'base64');

      var publicKey = rsa.setPublicKey(new BigInteger(n.toString('hex'), 16), new BigInteger(e.toString('hex'), 16));
      var bytes = forge.random.getBytesSync(32);
      client.setex(req.params.name, 10, new Buffer(bytes, 'binary').toString('hex'));
      var encrypted = publicKey.encrypt(bytes, 'RSA-OAEP', {
        md: forge.md.sha256.create()
      });

      res.json({time: Date.now().toString(), challenge: new Buffer(encrypted, 'binary').toString('hex')});
    }
    else{
      res.writeHead(404, 'User not found', {});
      res.end();
    }
  });
});

app.post('/share/:name/:title', function (req, res) {
  checkToken(req.params.name, req.body.token, function(valid){
    if(valid){
      if(req.params.name !== req.body.friendName){
        userExists(req.params.name, function(uExists, user, metaUser){
          if(uExists){
            userExists(req.body.friendName, function(uFExists, fUser, metaFUser){
              if(uFExists){
                secretExists(req.params.title, function(sExists, secret, metaSecret){
                  if(sExists){
                    if(typeof user.keys[req.params.title].rights !== 'undefined' && user.keys[req.params.title].rights > 1){
                      var secretDoc = {secret: {}};
                      secret.users.push(req.params.name)
                      secretDoc.secret[req.params.title] = secret

                      fUser.keys[req.params.title] = {
                        title: req.body.title,
                        key: req.body.key,
                        rights: req.body.rights
                      };

                      var fUserDoc = {user: {}};
                      fUserDoc.user[req.body.friendName] = fUser;

                      db.save(metaFUser.id, metaFUser.rev, fUserDoc, function (err, ret) {
                        if(err === null && ret.ok === true){
                          db.save(metaSecret.id, metaSecret.rev, secretDoc, function (err, ret) {
                            if(err === null && ret.ok === true){
                              res.writeHead(200, 'Secret shared', {});
                              res.end();
                            }
                            else{
                              console.log(err)
                              res.writeHead(500, 'Unknown error', {});
                              res.end();
                            }
                          });
                        }
                        else{
                          console.log(err)
                          res.writeHead(500, 'Unknown error', {});
                          res.end();
                        }
                      });
                    }
                    else{
                      res.writeHead(403, 'You can\'t share this secret', {});
                      res.end();
                    }
                  }
                  else{
                    res.writeHead(404, 'Secret not found', {});
                    res.end();
                  }
                });
              }
              else{
                res.writeHead(404, 'Friend not found', {});
                res.end();
              }
            });
          }
          else{
            res.writeHead(404, 'User not found', {});
            res.end();
          }
        });
      }
      else{
        res.writeHead(403, 'You can\'t share with youself', {});
        res.end();
      }
    }
    else{
      res.writeHead(403, 'Token invalid', {});
      res.end();
    }
  });
});

var server = app.listen(3000, function () {

  var host = server.address().address;
  var port = server.address().port;

  console.log('Listening at http://%s:%s', host, port);

});
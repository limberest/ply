'use strict';

const path = require('path');
const yaml = require('./yaml');
const postman = require('./postman');
const group = require('./group');
const compare = require('./compare');
const subst = require('./subst');
const Storage = require('./storage').Storage;
const Retrieval = require('./retrieval').Retrieval;
const isUrl = require('./retrieval').isUrl;
const Case = require('./case').Case;
const GitHub = require('./github').GitHub;
const Options = require('./options').Options;
const Logger = require('./logger').Logger;

function Ply() {
}

Ply.prototype.getLogger = function(options) {
  return new Logger({
    level: options.debug ? 'debug' : 'info',
    location: options.logLocation,
    name: 'ply.log',
    retain: options.retainLog
  });
};

// Load requests, returning an object (or promise if location is URL).
// TODO: ply.yaml is hardcoded
Ply.prototype.loadRequests = function(location) {
  if (isUrl(location)) {
    return this.loadRequestsAsync(location);
  }
  const str = new Storage(location).read();
  if (!str) {
    throw new Error('Location not found: ' + location);
  }
  if (str.startsWith('{') && postman.isCollection(JSON.parse(str))) {
    return this.loadCollection(location).getRequests();
  }
  else {
    const obj = yaml.load(location, str);
    const grp = {name: path.basename(location, '.ply.yaml'), requests: []};
    Object.keys(obj).forEach(key => {
      let request = Object.assign({name: key}, obj[key]);
      grp.requests.push(request);
    });
    return group.create(location, grp).getRequests();
  }
};

Ply.prototype.loadRequestsAsync = function(location) {
  const plyThis = this;
  return new Promise(function(resolve, reject) {
    if (isUrl(location)) {
      const async = require('async');
      var vals = {};
      async.map([location], function() {
        new Retrieval(location).loadAsync(function(err, data) {
          if (err) {
            reject(err);
          }
          else {
            try {
              if (data.startsWith('{')) {
                resolve(group.create(location, postman.group(JSON.parse(data))).getRequests());
              }
              else {
                const obj = yaml.load(location, data);
                const grp = {name: path.basename(location, '.ply.yaml'), requests: []};
                Object.keys(obj).forEach(key => {
                  let request = Object.assign({name: key}, obj[key]);
                  grp.requests.push(request);
                });
                resolve(group.create(location, grp).getRequests());
              }
            }
            catch (e) {
              reject(e);
            }
          }
          resolve(vals);
        });
      }, function(err) {
        if (err) {
          reject(err);
        }
        else {
          resolve(vals);
        }
      });
    }
    else {
      resolve(plyThis.loadRequests(location));
    }
  });
};

// Load cases, returning an object (or promise if location is URL).
// TODO: this isn't right -- see what workflow drives
Ply.prototype.loadCases = function(location) {
  if (isUrl(location)) {
    return this.loadCasesAsync(location);
  }
  const str = new Storage(location).read();
  if (!str) {
    throw new Error('Location not found: ' + location);
  }
  return this.parseCases(str);
};

// location is caseFile
Ply.prototype.loadCasesAsync = function(location) {
  const plyThis = this;
  return new Promise(function(resolve, reject) {
    if (isUrl(location)) {
      const async = require('async');
      var vals = {};
      async.map([location], function() {
        new Retrieval(location).loadAsync(function(err, data) {
          if (err) {
            reject(err);
          }
          else {
            // parse case file for runs
            try {
              resolve(plyThis.parseCases(data));
            }
            catch (e) {
              reject(e);
            }
          }
          resolve(vals);
        });
      }, function(err) {
        if (err) {
          reject(err);
        }
        else {
          resolve(vals);
        }
      });
    }
    else {
      resolve(plyThis.loadCases(location));
    }
  });
};

// TODO: this is silly
// TODO: should this be cases or runs?  let workflow needs decide
// TODO: real regex, better parsing, and true instantiation
Ply.prototype.parseCases = function(js) {
  const cases = {};
  var regex = /new Case\('(.*)'.*\)/g;
  var match = regex.exec(js);
  if (match) {
    var caseName = match[1];
    regex = /run\(.*, '(.*)'\)/g;
    match = regex.exec(js);
    while (match !== null) {
      cases[match[1]] = {
        group: caseName,
        name: match[1]
      };
      match = regex.exec(js);
    }
  }
  return cases;
};

// Load values, returning an object (or promise if location is URL).
Ply.prototype.loadValues = function(location) {
  if (isUrl(location)) {
    return this.loadValuesAsync(null, [location]);
  }
  const obj = JSON.parse(new Storage(location).read());
  if (!obj)
    throw new Error('Values not found: ' + location);
  return postman.isEnv(obj) ? postman.values(obj) : obj;
};

Ply.prototype.loadValuesAsync = function(options, paths) {
  return new Promise(function(resolve, reject) {
    const async = require('async');
    var vals = {};
    async.map(paths, function(path) {
      var loc = options ? options.location + '/' + path : path;
      new Retrieval(loc).loadAsync(function(err, data) {
        if (err) {
          reject(err);
        }
        else {
          try {
            var obj = JSON.parse(data);
            obj = postman.isEnv(obj) ? postman.values(obj) : obj;
            vals = Object.assign(vals, obj);
          }
          catch (e) {
            reject(e);
          }
        }
        resolve(vals);
      });
    }, function(err) {
      if (err) {
        reject(err);
      }
      else {
        resolve(vals);
      }
    });
  });
};

// Load a collection, returning object (or promise if location is URL).
// Does not merge local storage.
Ply.prototype.loadCollection = function(location) {
  if (isUrl(location)) {
    return this.loadCollectionAsync(location);
  }
  const obj = JSON.parse(new Storage(location).read());
  if (!obj) {
      throw new Error('Location not found: ' + location);
  }
  if (postman.isCollection(obj)) {
    return group.create(location, postman.group(obj));
  }
  else {
    return group.create(location, obj);
  }
};

// Does not merge local storage.
Ply.prototype.loadCollectionAsync = function(location) {
  return new Promise(function(resolve, reject) {
    new Retrieval(location).loadAsync(function(err, data) {
      if (err) {
        reject(err);
      }
      else {
        if (!err) {
          try {
            const obj = JSON.parse(data);
            if (postman.isCollection(obj)) {
              resolve(group.create(location, postman.group(obj)));
            }
            else {
              resolve(group.create(location, obj));
            }
          }
          catch (e) {
            reject(e);
          }
        }
      }
    });
  });
};

// Merges local storage if retrieved from remote.
Ply.prototype.loadAllCollectionsAsync = function(options) {
  options = new Options(options).options;
  var source;
  if (options.location.startsWith('https://') || options.location.startsWith('http://')) {
    source = new GitHub(options.location);
  }
  else {
    source = new Storage(options.location);
  }
  var plyThis = this;
  return new Promise((resolve, reject) => {
    source.getMatches(options, function(err, matches) {
      var groups = [];
      matches.forEach(match => {
        var obj = JSON.parse(match.contents);
        let grp;
        if (postman.isCollection(obj)) {
          grp = group.create(match.location, postman.group(obj));
          grp.postmanObj = obj;
        }
        else {
          grp = group.create(match.location, obj);
          const lastDot = match.name.lastIndexOf('.');
          grp.name = lastDot > 0 ? match.name.substring(0, lastDot) : match.name;
        }

        grp.filename = match.name;
        grp.origin = match.origin;
        grp.uiOrigin = match.uiOrigin;

        plyThis.syncGroup(options, grp);
        groups.push(grp);
      });
      if (err) {
        reject(err);
      }
      else {
        resolve(groups);
      }
    });
  });
};

Ply.prototype.loadFile = function(location) {
  if (isUrl(location)) {
    return this.loadFileAsync(null, [location]);
  }
  return new Storage(location).read();
};

Ply.prototype.loadFileAsync = function(options, path) {
  return new Promise(function(resolve, reject) {
    if (options.localLocation) {
      // check local-only
      var storage = new Storage(options.localLocation + '/' + path.substring(0, path.lastIndexOf('/')));
      if (storage.exists()) {
        var file = JSON.parse(storage.read()).find(localFile => {
          return localFile.path === path;
        });
        if (file) {
          return resolve(file.contents);
        }
      }
      // check local override
      storage = new Storage(options.localLocation + '/' + path);
      if (storage.exists()) {
        return resolve(storage.read());
      }
    }
    // pull from original source
    new Retrieval(options.location + '/' + path).loadAsync(function(err, contents) {
      if (err) {
        reject(err);
      }
      else {
        resolve(contents);
      }
    });
  });
};

// Does not merge local storage (TODO: needed?).
Ply.prototype.refreshFile = function(location) {
  return new Promise(function(resolve, reject) {
    new Retrieval(location).loadAsync(function(err, contents) {
      if (err) {
        reject(err);
      }
      else {
        resolve(contents);
      }
    });
  });
};

// Merges local storage if retrieved from remote.
Ply.prototype.loadFiles = function(options) {
  options = new Options(options).options;
  var source;
  if (options.location.startsWith('https://') || options.location.startsWith('http://')) {
    source = new GitHub(options.location);
  }
  else {
    source = new Storage(options.location);
  }
  return new Promise(function(resolve, reject) {
    source.getMatches(options, function(err, matches) {
      if (err) {
        reject(err);
      }
      else {
        var files = matches.slice();
        if (options.localLocation) {
          var localLoc = options.localLocation;
          if (options.qualifier)
            localLoc += '/' + options.qualifier;
          // find local-only files
          var storage = new Storage(localLoc + '/' + options.path);
          if (storage.exists()) {
            JSON.parse(storage.read()).forEach(localFile => {
              var matchingExt = options.extensions.find(ext => {
                return localFile.name.endsWith(ext);
              });
              if (matchingExt) {
                files.push(localFile);
              }
            });
          }
          files.forEach(file => {
            // merge from local
            storage = new Storage(localLoc + '/' + file.path);
            if (storage.exists()) {
              if (options.debug)
                console.log('Merging from local: ' + storage);
              file.contents = storage.read();
              file.location = localLoc + '/' + file.path;
            }
          });
        }
        resolve(files);
      }
   });
  });
};

Ply.prototype.fileHasLocal = function(options, path) {
  if (options.localLocation) {
    var localLoc = options.localLocation;
    if (options.qualifier)
      localLoc += '/' + options.qualifier;
    return new Storage(localLoc + '/' + path).exists();
  }
};

// Updates local storage.  Does not save to origin.
Ply.prototype.updateFile = function(options, file) {
  if (!options.localLocation)
    throw new Error('No localLocation specified in options');
  var storage = new Storage(options.localLocation + '/' + file.path);
  storage.write(file.contents);
  file.location = options.localLocation + '/' + file.path;
};

// Removes local storage override.
Ply.prototype.discardFile = function(options, file) {
  if (!options.localLocation)
    throw new Error('No localLocation specified in options');
  var storage = new Storage(options.localLocation + '/' + file.path);
  storage.remove();
  file.location = file.origin;
  // remove from local-only (newly-added file)
  var localFiles = [];
  storage = new Storage(options.localLocation + '/' + options.path);
  if (storage.exists()) {
    localFiles = JSON.parse(storage.read());
    var idx = localFiles.findIndex(localFile => {
      return localFile.path === file.path;
    });
    if (idx >= 0) {
      localFiles.splice(idx, 1);
      storage.write(JSON.stringify(localFiles));
    }
  }
};

// Creates in local storage.  Does not save to origin.
Ply.prototype.createFile = function(options, file) {
  if (!options.localLocation)
    throw new Error('No localLocation specified in options');
  file.contents = '';
  file.location = options.localLocation + '/' + file.path;
  // add to local-only files
  var localFiles = [];
  var storage = new Storage(options.localLocation + '/' + options.path);
  if (storage.exists()) {
    localFiles = JSON.parse(storage.read());
  }
  localFiles.push(file);
  storage.write(JSON.stringify(localFiles));
};

// Saves from local storage to origin.
Ply.prototype.saveFile = function(options, token, file, message) {
  return new Promise((resolve, reject) => {
    const github = new GitHub(options.location);
    github.commitAndPush(token, file, message, err => {
      if (err) {
        reject(err);
      }
      else {
        resolve();
      }
    });
  });
};

Ply.prototype.updateRequest = function(options, groupName, request) {
  if (!options.localLocation)
    throw new Error('No localLocation specified in options');
  var resName = this.getResourceName(request);
  var storage = new Storage(options.localLocation + '/' + groupName, resName);
  storage.write(JSON.stringify(request));
  request.location = options.localLocation + '/' + groupName + '/' + resName;
};

Ply.prototype.discardRequest = function(options, groupName, request) {
  if (!options.localLocation)
    throw new Error('No localLocation specified in options');
  var resName = this.getResourceName(request);
  var storage = new Storage(options.localLocation + '/' + groupName, resName);
  storage.remove();
  delete request.location;

  // remove from local-only (newly-added request)
  var grpStore = new Storage(options.localLocation + '/' + groupName);
  if (grpStore.exists()) {
    var localRequests = JSON.parse(grpStore.read());
    var idx = localRequests.findIndex(localRequest => {
      return localRequest.method === request.method && localRequest.name === request.name;
    });
    if (idx >= 0) {
      localRequests.splice(idx, 1);
      grpStore.write(JSON.stringify(localRequests));
    }
  }
};

// Creates in local storage.  Does not save to origin.
Ply.prototype.createRequest = function(options, groupName, request) {
  if (!options.localLocation)
    throw new Error('No localLocation specified in options');
  var resName = this.getResourceName(request);
  request.url = '';
  request.header = {};
  if (request.method !== 'GET' && request.method !== 'DELETE') {
    request.body = '';
  }
  request.expected = '';
  request.location = options.localLocation + '/' + groupName + '/' + resName;
  // add to local-only requests
  var localRequests = [];
  var storage = new Storage(options.localLocation + '/' + groupName);
  if (storage.exists()) {
    localRequests = JSON.parse(storage.read());
  }
  request._local = true;
  localRequests.push(request);
  storage.write(JSON.stringify(localRequests));
};

// Merges this request into group, and pushes to origin.
Ply.prototype.saveRequest = function(options, token, groupName, request, message) {
  return new Promise((resolve, reject) => {
    const github = new GitHub(options.location);
    var path = options.path + '/' + groupName + options.extensions[0]; // TODO
    github.get({path: path}, contents => {
      var obj = JSON.parse(contents);
      if (postman.isCollection(obj)) {
        postman.setRequest(obj, request);
      }
      else {
        obj = group.create(options.location + '/' + path, obj);
        obj.setRequest(request);
      }
      github.commitAndPush(token, {path: path, contents: JSON.stringify(obj, null, 2)}, message, err => {
        if (err) {
          reject(err);
        }
        else {
          delete request.location;
          delete request._local;
          resolve();
        }
      });
    });
  });
};


// Builds group requests (including expected results), merging from local storage.
Ply.prototype.constructGroup = function(options, group) {
  if (options.localLocation) {
    // find local-only requests
    var grpStore = new Storage(options.localLocation + '/' + group.name);
    if (grpStore.exists()) {
      JSON.parse(grpStore.read()).forEach(localRequest => {
        localRequest._local = true;
        group.requests.push(localRequest);
      });
    }

    // merge from local (individual tests)
    group.requests.forEach(request => {
      var storage = new Storage(options.localLocation + '/' + group.name, this.getResourceName(request));
      if (storage.exists()) {
        var requestStr = storage.read();
        if (requestStr) {
          var localRequest = JSON.parse(requestStr);
          request.method = localRequest.method;
          request.url = localRequest.url;
          request.headers = localRequest.headers;
          request.body = localRequest.body;
          request.location = storage.path;
        }
      }
      storage = new Storage(options.localLocation + '/' + group.name,
          this.getResourceName(request.method, request.name, 'yaml'));
      if (storage.exists())
        request.expectedLocation = storage.path;  // indicate exp res overridden
    });
  }
};

// Reconstructs group from current request contents.
// Calls this.constructGroup to build from merged local storage.
Ply.prototype.syncGroup = function(options, group) {
  this.constructGroup(options, group);
  const fileName = group.name + options.extensions[0]; // TODO
  group.file = {
      name: fileName,
      path: options.path + '/' + fileName,
      origin: group.origin
  };
  group.requests.forEach(request => {
    if (group.postmanObj) {
      postman.setRequest(group.postmanObj, request);
      // postman uses tabs
      group.file.contents = JSON.stringify(group.postmanObj, null, '\t');
    }
    else {
      group.setRequest(request);
      group.file.contents = JSON.stringify(group, null, 2);
    }
  });
};

Ply.prototype.loadExpectedAsync = function(options, groupName, request) {
  options = new Options(options).options;
  var resName = this.getResourceName(request.method, request.name, 'yaml');
  request.expectedName = require('sanitize-filename')(resName, {replacement: '_'});
  request.expectedPath = options.resultPath + '/' + groupName + '/' + request.expectedName;
  if (options.location.startsWith('https://github.com') || options.location.startsWith('https://raw.githubusercontent.com')) {
    request.expectedOrigin = options.expectedResultLocation + '/' + groupName + '/' + request.expectedName;
    request.expectedUiOrigin = options.location + '/blob/' + options.branch + '/' + request.expectedPath;
  }
  const plyThis = this;
  return new Promise((resolve, reject) => {
    if (options.localLocation) {
      // check first in local
      var storage = new Storage(options.localLocation + '/' + groupName, resName);
      plyThis.getLogger(options).debug('Loading expected result: ' + storage);
      if (storage.exists()) {
        request.expectedLocation = options.localLocation + '/' + groupName + '/' + resName;
        resolve(storage.read());
        return;
      }
    }
    var retrieval = new Retrieval(options.expectedResultLocation + '/' + groupName, resName);
    plyThis.getLogger(options).debug('Loading expected result: ' + retrieval);
    retrieval.loadAsync((err, contents) => {
      if (err) {
        reject(err);
      }
      else {
        resolve(contents);
      }
    });
  });
};

Ply.prototype.updateExpectedResult = function(options, groupName, request, result) {
  if (!options.localLocation)
    throw new Error('No localLocation specified in options');
  var resName = this.getResourceName(request.method, request.name, 'yaml');
  var storage = new Storage(options.localLocation + '/' + groupName, resName);
  storage.write(result);
  request.expectedLocation = options.localLocation + '/' + groupName + '/' + resName;
};

Ply.prototype.discardExpectedResult = function(options, groupName, request) {
  if (!options.localLocation)
    throw new Error('No localLocation specified in options');
  var resName = this.getResourceName(request.method, request.name, 'yaml');
  var storage = new Storage(options.localLocation + '/' + groupName, resName);
  storage.remove();
  delete request.expectedLocation;
};

Ply.prototype.saveExpectedResult = function(options, token, groupName, request, result, message) {
  return new Promise((resolve, reject) => {
    const github = new GitHub(options.location);
    var path = options.resultPath + '/' + groupName + '/';
    path += require('sanitize-filename')(this.getResourceName(request.method, request.name, 'yaml'), {replacement: '_'});
    github.commitAndPush(token, {path: path, contents: result}, message, err => {
      if (err) {
        reject(err);
      }
      else {
        resolve();
      }
    });
  });
};

Ply.prototype.loadRequestActual = function(groupName, method, name, options) {
  var resName = this.getResourceName(method, name, 'yaml');
  return new Promise(resolve => {
    var storage = new Storage(new Options(options).options.resultLocation + '/' + groupName, resName);
    resolve(storage.exists ? storage.read() : null);
  });
};

Ply.prototype.loadRequestLog = function(groupName, method, name, options) {
  var resName = this.getResourceName(method, name, 'log');
  return new Promise(resolve => {
    var storage = new Storage(new Options(options).options.logLocation + '/' + groupName, resName);
    resolve(storage.exists ? storage.read() : null);
  });
};

Ply.prototype.loadActual = function(path, resName, options) {
  var resultLoc = new Options(options).options.resultLocation;
  if (path)
    resultLoc += '/' + path;
  return new Promise(resolve => {
    var storage = new Storage(resultLoc, resName + '.yaml');
    resolve(storage.exists ? storage.read() : null);
  });
};

Ply.prototype.loadLog = function(path, resName, options) {
  var logLoc = new Options(options).options.logLocation;
  if (path)
    logLoc += '/' + path;
  return new Promise(resolve => {
    var storage = new Storage(logLoc, resName + '.log');
    resolve(storage.exists ? storage.read() : null);
  });
};

// abbreviated method for naming
Ply.prototype.getResourceName = function(method, name, ext) {
  var meth = method;
  if (typeof method === 'object') {
    // actually a request passed
    meth = method.method;
    name = method.name;
    ext = 'request';
  }
  if (meth == 'DELETE')
    meth = 'DEL';
  else if (meth == 'OPTIONS')
    meth = 'OPT';
  return meth + ':' + name + '.' + ext;
};

Ply.prototype.getRequest = function() {
  if (typeof window === 'undefined') {
    return require('request').defaults({headers: {'User-Agent': 'ply'}});
  }
  else {
    return require('browser-request');
  }
};

Ply.prototype.GitHub = GitHub;
Ply.prototype.Storage = Storage;
Ply.prototype.Retrieval = Retrieval;
Ply.prototype.Case = Case;
Ply.prototype.Logger = Logger;
Ply.prototype.postman = postman;
Ply.prototype.compare = compare;
Ply.prototype.subst = subst;
Ply.prototype.createGroup = group.create;
module.exports = new Ply();
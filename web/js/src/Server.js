/*
 * This software stands under the Apache 2 License
 *
 * Using node.js v0.2.4
 */


require('./json2');

// require statements are not hotupdateable
// process is a global variable

var http = require('http');
//var querystring = require('querystring');
var url = require('url');
var fs = require('fs');
var util = require('util');

// require is necessary for JSii
var BitSet = require('./BitSet');
var JSii = require('./JSii');
var SolrClient = require("./SolrClient");
var XmlHandler = require("./XmlHandler");

// feed docs from solr into our index
var engine = new JSii();
engine.defaultSearchField = 'tw';
    
var querySolr = function(webapp, login, pw) {
    // var client = new SolrClient("localhost", "8082", "solr");
    var client = new SolrClient("pannous.info", "80", webapp, login, pw);
    var queryStr = "";
    var feedingInProcess = false;

    var feedDocsCallBack = function (err, response) {
        if(err) throw "Error occured when receiving response:" + err;
     
        var responseObj = JSON.parse(response);
        if(responseObj == null) {
            console.log("Something goes wrong. response was null");
            return;
        }
        
        var start = new Date().getTime();
        engine.feedDocs(responseObj.response.docs);
        var time = (new Date().getTime() - start) / 1000.0;
        console.log(new Date() + "| " + JSON.stringify(responseObj.responseHeader.params) + " returned " + responseObj.response.docs.length + " documents. "+
            "feeding time:"+time+" total:" + responseObj.response.numFound + ' RAM:' + process.memoryUsage().heapUsed / 1024 / 1024 + ' MB');
        feedingInProcess = false;
    };
    
    var options = {};
    options.start = 0;
    options.rows = 1000;
    var max = 1000 * 20;
    
    // prefer english/german lang
    options.fq = "lang:en";
    var intervalId = setInterval(function() {
        if(feedingInProcess)
            return;
        
        feedingInProcess = true;
        client.query(queryStr, options, feedDocsCallBack);
        options.start += options.rows;

        // Stops a interval from triggering
        if(options.start > max)
            clearInterval(intervalId);
    }, 10000);
}

// TODO at the moment it is necessary to avoid a new line
fs.open("src/pw.txt", "r", 0666, function(err, fd){
    if (err) throw err;
    fs.read(fd, 10000, null, 'utf8', function(err,str,count) {
        if (err) throw err;
        var pwLine = str.split(" ");
        var webapp = pwLine[0];
        var login = pwLine[1];
        var pw = pwLine[2];

        querySolr(webapp, login, pw);
        fs.close(fd);
    });
});


// static mini example feeding
//engine.feedDocs([{
//    id:1,
//    tw : "unschlüssig blup",
//    user: "peter",
//    repl_i : 0,
//    retw_i : 0
//}, {
//    id:2,
//    tw : "blap blup",
//    user: "test",
//    repl_i : 0,
//    retw_i : 0
//}]);

// accept clients
http.createServer(function (request, response) {
    try {
        if(request.url == undefined)
            show404(request, response);
        else {
            var path = url.parse(request.url, true).pathname;
            switch (path) {
                case '/select/':
                case '/select':
                    query(request, response);
                    break;
                default:
                    show404(request, response);
                    break;
            }
        }
    } catch(ex) {
        console.log(new Date() + "| ERROR: " + ex);
    }
}).listen(8124, "0.0.0.0"); // 127.0.0.1 won't be available from outside

console.log('Server running at http://0.0.0.0:8124/');

var errorMessage = "Use select?q=query to query the in-memory index or use update/ to feed it!";

function query(request, response) {   
    var params = url.parse(request.url, true).query;
    if(params == undefined) {
        response.writeHead(404, {
            'content-type': 'text/plain; charset=UTF-8'
        });
        response.write('{"responseHeader": {"status": 1, "QTime": 0, "error": "'+errorMessage+'"}, "response":{"numFound":0}}');
    } else {
        params.q = params.q || "";
        params.start = params.start || 0;
        var start = new Date().getTime();
        var sortMethod = engine.createSortMethod(params.sort);
        var result = engine.search(params.q, params.start, params.rows, sortMethod);
        var time = new Date().getTime() - start;
        console.log(new Date() + "| new query:" + JSON.stringify(params));
        if(params.wt == "json") {
            writeJson({
                response: response,
                time : time,
                params : params
            }, result);
        } else {
            writeXml({
                response: response,
                time : time,
                params : params
            }, result);
        }
    }
    response.end();
}

function show404(req, res) {
    res.writeHead(404, {
        'Content-Type': 'text/plain'
    });
    res.write('{"responseHeader": {"status": 1, "QTime": 0, "error": "'+errorMessage+'"}, "response":{"numFound":0}}');
    res.end();
}

function writeXml(arg, result) {
    var time = arg.time;
    var response = arg.response;
    var params = arg.params;
    var xml = new XmlHandler();
    xml.prettyPrint = true;
    xml.header().start('response');
    xml.startLst("responseHeader").
    createInt("status", 0).
    createInt("QTime", time);

    xml.startLst("params");
    for(var prop in params) {
        xml.createStr(prop, params[prop]);
    }
    xml.end();
    xml.end();

    xml.start('result', {
        name:"response",
        numFound: result.total,
        start: params.start
    }).writeDocs(result.docs).end();
    xml.end();
    response.writeHead(200, {
        'content-type': 'text/xml; charset=UTF-8'
    });    
    response.write(xml.toXml());
}

function writeJson(arg, result) {
    var time = arg.time;
    var response = arg.response;
    var params = arg.params;
    response.writeHead(200, {
        'content-type': 'text/plain; charset=UTF-8'
    });
    response.write('{"responseHeader": {"status":0, "QTime": '+time);
    response.write(',"params": ' + JSON.stringify(params));

    // jsii 'extension'
    response.write(',"jsii": ' + JSON.stringify({
        date: new Date()
    }));

    response.write('},\n"response":{"numFound":'+result.total+', "start":' + params.start + ',\n');
    response.write('"docs":[');

    for(var i = 0; i < result.docs.length; i++) {
        if( i > 0)
            response.write(",\n");
        response.write(JSON.stringify(result.docs[i]));
    }

    response.write("\n]}}");
}
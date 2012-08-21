define([
  "dojo/_base/lang",
  "dojo/_base/array",
  "dojo/_base/declare",
  "dojo/_base/Deferred",
  "dojo/store/util/QueryResults","Lightstreamer/Subscription"
], function(lang,array,declare,Deferred,QueryResults,Subscription){
  dojo.getObject("store", true, dojox);

  // NOTE: The Lightstreamer JavaScript client library MUST be available in your lib folder
  // and MUST be included in your html file before this module can be used. 
  // Also, the included Lightstreamer JS Client MUST be in its "namespaced AMD" form.

  var nextId = 0;

  var _ITEM_IS_KEY = "ITEM_IS_KEY";
  var _UPDATE_IS_KEY = "UPDATE_IS_KEY";
  var _KEY_IS_KEY = "KEY_IS_KEY";

  function translate(id, updateInfo, schema, o){
    //  private function to convert the returned object from an update to a JSON-like object.
    o = o || {};
    updateInfo.forEachChangedField(function (fieldName,fieldPos,value) {
      o[fieldName] = value;
    });
    
    if(!("id" in o)){ o["id"] = id; };
    
    return o;
  };

  var LightstreamerStore = declare("dojox.store.LightstreamerStore", null, {
    _index: {},  //  a cache for data objects returned

    //  client: (Lightstreamer)LightstreamerClient
    //    The main connection created by the typical Lightstreamer JavaScript Client
    client: null,
    
    //  itemsList: String[]
    //    The list of items to be returned from the Lightstreamer Server.
    itemsList: [],
    
    //  fieldsList: String[]
    //    The list of fields for each item you wish to get back from Lightstreamer
    fieldsList: [],
    
    listeners: {},
    
    listnsCount: 0,
    
    kind: null,
    _commandKeys: {},

    constructor: function(client, itemsList, fieldsList, dataAdapter){
      //  summary:
      //    The constructor for the LightstreamerStore.
      //  client: LightstreamerClient
      //    An instance of LightstreamerClient connected with Lightstreamer server.
      //  itemsList: String[]
      //    An array of the item names you wish to get back from Lightstreamer.
      //  fieldsList: String[]
      //    The list of fields for each item you wish to get back from Lightstreamer.
      //  dataAdapter: String
      //    This is the data adapter to connect to (defined with the Lightstreamer server)
      
      this.client = client;
      
      this.itemsList = itemsList;
      this.fieldsList = fieldsList;
      
      this.dataAdapter = dataAdapter || "DEFAULT";
    },

    query: function(query, options){
      //  summary:
      //    Start receiving streams from the Lightstreamer server.
      //
      //  description:
      //    The main method of the LightstreamerStore, query opens up a data stream
      //    from a Lightstreamer server (based on the LightstreamerClient definition used in the
      //    constructor) and sets up a way to observe the returned results from said
      //    stream.  It is based on Lightstreamer's Subscription object, and by
      //    default will run the return from the Lightstreamer server through a 
      //    private "translate" function, which takes the updateInfo object normally
      //    returned by Lightstreamer's JavaScript client and converts it into a straight
      //    JSON-like object that can be used for data consumption.
      //
      //  query: String
      //    The name of the mode to use for the resulting stream. (RAW, MERGE, COMMAND or DISTINCT)
      //    
      //  options: LightstreamerStore.__QueryOptionsArgs
      //    Additional options to consume. See http://www.lightstreamer.com/docs/client_javascript_uni_api/Subscription.html
      //    for more information on these properties. All properties are optional.
      //
      //  returns: dojo.store.util.QueryResults
      //    A query results object that can be used to observe data being returned,
      //    as well as stop the stream of data.  Note that this results object is
      //    customized with an "observe" method and a "close" method; observe is the
      //    main hook into the constant data stream returned by Lightstreamer, and
      //    the close method will stop the query/stream.
      //
      //  example:
      //    Query a server:
      //  |  var results = myLSStore.query("MERGE", { dataAdapter: "QUOTE_ADAPTER", snapshotRequired: true });
      //  |  results.observe(function(obj){
      //  |    //  do something with obj
      //  |  });
      
      if (query == "MERGE" || query == "RAW") {
          this.kind = _ITEM_IS_KEY;
        } else if (query == "DISTINCT") {
          this.kind = _UPDATE_IS_KEY;
        } else { //Constants._COMMAND
          this.kind = _KEY_IS_KEY;
        }
      
      options = options || {};
      var results = new dojo.Deferred(),
        snapshotReceived,
        resultsArray = [],
        self = this,
        id = 0,
        subscription = new Subscription(query, this.itemsList, this.fieldsList );
      
      if(!("dataAdapter" in options) && this.dataAdapter){
        subscription.setDataAdapter(this.dataAdapter);
      }
      
      for(var prop in options) {
        var setter = "set" + prop.charAt(0).toUpperCase() + prop.slice(1);
        if(setter in subscription && dojo.isFunction(subscription[setter])){
          subscription[setter]["call"](subscription, options[prop]);
        }
      }
      
      subscription.addListener({
        onItemUpdate: function(updateInfo) {
          var objId;
          var newObject = false;
          var oldObject = false;
          if (self.kind == _ITEM_IS_KEY) {
            objId = updateInfo.getItemPos() - 1;
          } else if (self.kind == _UPDATE_IS_KEY ) {
            objId = id++;
          } else { //_KEY_IS_KEY
            if (!self._commandKeys[updateInfo.getValue("key")]) {
              self._commandKeys[updateInfo.getValue("key")] = id++;
            }
            objId = self._commandKeys[updateInfo.getValue("key")];
            
            if ( updateInfo.getValue("command") == "DELETE" ) {
              oldObject = true;
            }
          }
          
          var obj = translate(objId, updateInfo, self.fieldsList, self._index[objId]);
          
          if(!self._index[objId]){
            newObject = true;
            self._index[objId] = obj;
          }
          
          if ( objId > -1 ) {
            subscription["onPostSnapShot"](obj, newObject, objId, oldObject);
          } 
        },
        
        onEndOfSnapshot: function(itemName, itemPos) {
          snapshotReceived = true;
          results.resolve(resultsArray);
        }
      });

      if( query == "MERGE" || query == "RAW" || options.RequestedSnapshot == "no" ) {
        snapshotReceived = true;
        results.resolve(resultsArray);
      }

      subscription.onPostSnapShot = function(){};

      //  modify the deferred
      results = dojo.store.util.QueryResults(results);

      //  set up the main way of working with results
      var observeHandler;
      results.observe = function(listener){       
      
        console.log("observe.");
      
        self.listeners[self.listnsCount++] = listener;

        observeHandler = dojo.connect(subscription, "onPostSnapShot", function(object, newObject, objid, oldObject){
          listener.call(results, object, newObject ? -1 : objid, oldObject ? -1 : objid);
        });
      };

      //  set up the way to stop the stream

      results.close = function(){
        if(observeHandler){ dojo.disconnect(observeHandler); }
        this.client.unsubcribe(subscription);
        subscription = null;
      };

      //  start up the stream
      this.client.subscribe(subscription);
      
      return results;
    },
    get: function(id){
      //  summary:
      //    Return a (cached) object from the Lightstreamer.
      //  id: String
      //    The identity of the object to retrieve.
      return this._index[id];
    },
    getIdentity: function(object){
      //   summary:
      //    Returns an object's identity
      //   object: Object
      //    The object to get the identity from
      //  returns: Number
      return object["id"];
    }
  });

  return LightstreamerStore;
});

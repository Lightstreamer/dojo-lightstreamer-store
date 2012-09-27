define([
  "dojo/_base/declare",
  "dojo/store/util/QueryResults",
  "dojo/store/util/SimpleQueryEngine",
  "dojox/collections/ArrayList",
  "dojox/collections/Dictionary",
  "Lightstreamer/Subscription"
], function(declare,QueryResults,SimpleQueryEngine,ArrayList,Dictionary,Subscription){

  // NOTE: The Lightstreamer JavaScript client library MUST be available in your lib folder
  // and MUST be included in your html file before this module can be used. 
  // Also, the included Lightstreamer JS Client MUST be in its "namespaced AMD" form.

  var _ITEM_IS_KEY = "ITEM_IS_KEY";
  var _UPDATE_IS_KEY = "UPDATE_IS_KEY";
  var _KEY_IS_KEY = "KEY_IS_KEY";

  function translate(key, updateInfo, o){
    //  private function to convert the returned object from an update to a JSON-like object.
    o = o || {};
    updateInfo.forEachChangedField(function (fieldName,fieldPos,value) {
      o[fieldName] = value;
    });
    
    if(!("id" in o)){ o["id"] = key; };
    
    return o;
  };
  
  
   
  var LightstreamerStore = declare(null, {
  

    constructor: function(client, options){
      //  summary:
      //    The constructor for the LightstreamerStore.
      //  client: LightstreamerClient
      //    An instance of LightstreamerClient connected with Lightstreamer server.
      //  options: Object
      //    options: Object
      //    Subscription configuration options. TODO list options here
      
      this.queryEngine = SimpleQueryEngine;
      this.data = new Dictionary(); //  a cache for data objects returned
      this.client = client;
      this.listeners = new ArrayList();
      this.updateId = 0;
   
      // configure the subscription
      this.subscription = new Subscription(options.mode);
      for(var prop in options) {
        var setter = "set" + prop.charAt(0).toUpperCase() + prop.slice(1);
        if(setter in this.subscription && dojo.isFunction(this.subscription[setter])){
          this.subscription[setter]["call"](this.subscription, options[prop]);
        }
      }

      //TODO conflicts may arise if there is an "id" field in the field list 
      if (options.kind) {
        this.kind = options.kind;
      } else if (options.mode == "MERGE" || options.mode == "RAW") {
        this.kind = _ITEM_IS_KEY;
      } else if (options.mode == "DISTINCT") {
        this.kind = _UPDATE_IS_KEY;
      } else { //options.mode == "COMMAND"
        this.kind = _KEY_IS_KEY;
      }
      
      var self = this;
      this.subscription.addListener({
        onItemUpdate: function(updateInfo) {
          var key = self.getUpdateKey(updateInfo);     
          var updateObj = translate(key,updateInfo,self.data.item(key));
          self.put(updateObj);
        },
        
        onSubscription: function() {
          //as soon as we subscribe we clean all the data currently in the store
          //we may make this cleaning optional
          self.clear();          
        },
        
        onUnsubscription: function() {
          // we may want to move the "onSubscription code" here
          self.clear();          
        }
      });
      
      
      this.client.subscribe(this.subscription);
      
    },
    
    query: function(query,options) {
      // use the query engine to filter results based on the query
      // and wrap the returned set in a QueryResult
      var results = QueryResults(this.queryEngine(query, options)(this.data.getValueList()));
    
      var that = this;
      //Substitute results observe method with a custom version.
      results.observe = function(observeListener) {
        
        var listener = {
            resultsArray: results,
            listener: observeListener,
            query: query,
            options: options 
        };
        
        that.listeners.add(listener);
        
        return {
          cancel: function() {
            that.listeners.remove(listener);
          }
        };
      };
      
      return results;
    },
    
    
    updateResults: function(key) {
      var updatedObject = this.get(key);

      //TODO currently it does not take into account the start and count filters
      
      this.listeners.forEach(function(o) {
        //Verify if this update is already in the resultArray
        //and find its current position
        var oldPosition = -1;
        for(var i = 0; i < o.resultsArray.length && oldPosition == -1; i++){
          if(this.getIdentity(o.resultsArray[i]) == key){
            oldPosition = i;
          }
        }
        
        // run query to verify if the element still pertains/now pertains to the result set
        // in case of a COMMAND subscription a DELETE command means the elements does not exist anymore
        // thus we remove it from the result set
        var matches = !updatedObject || this.kind ==  _KEY_IS_KEY && updatedObject["command"] == "DELETE" ? false : this.queryEngine(o.query)([updatedObject]).length;
        if (!matches) {
          if (oldPosition > -1) {
            updatedObject = updatedObject || {id:key};
            //remove from results
            o.resultsArray.splice(oldPosition,1);
            //notify removal
            o.listener(updatedObject, oldPosition, -1);
          } //else is simply not relevant in this result set 
          
          return;
        } 
        
        //if oldPostion then just update, otherwise push it
        if (oldPosition <= -1) {
          //element wasn't in the array, let's push it
          o.resultsArray.push(updatedObject);
        }
        
        var newPosition = -1;
        //use sort to sort the array
        
        if (o.options && o.options.sort) {
          
          // from SimpleQueryEngine
          var sortSet = o.options.sort;
          o.resultsArray.sort(typeof sortSet == "function" ? sortSet : function(a, b){
            for(var sort, i=0; sort = sortSet[i]; i++){
              var aValue = a[sort.attribute];
              var bValue = b[sort.attribute];
              if (aValue != bValue){
                return !!sort.descending == (aValue == null || aValue > bValue) ? -1 : 1;
              }
            }
            return 0;
          });
          
          //find new postion
          for(var i = 0; i < o.resultsArray.length && newPosition == -1; i++){
            if(this.getIdentity(o.resultsArray[i]) == key){
              newPosition = i;
            }
          }
          
        } else {
          //new position is the end of the set or previous position if any
          newPosition = oldPosition <= -1 ? o.resultsArray.length-1 : oldPosition;
        }
        
        o.listener(updatedObject, oldPosition, newPosition);
        
      },this);
   
    },
    
    getUpdateKey: function(updateInfo) {
      if (this.kind == _ITEM_IS_KEY) {
        return updateInfo.getItemPos();
        
      } else if (this.kind == _KEY_IS_KEY ) {
        return updateInfo.getValue("key");
        
      } else { //_UPDATE_IS_KEY
        return ++this.updateId;
      }
    },
    
    clear: function() {
      var itr = this.data.getIterator();
      while(!itr.atEnd()){   
        this.remove(itr.get()["key"]); 
      }
    },
    
    put: function(obj){
      var key = this.getIdentity(obj);
      
      if (this.kind == _KEY_IS_KEY && obj["command"] == "DELETE") {
        //special put call (for COMMAND mode handling)
        this.remove(key);
        
      } else {
        //regular put
        this.data.add(key,obj);
        this.updateResults(key);
      }
      
    },
    
    remove: function(key) {
      this.data.remove(key);
      this.updateResults(key);
    },
    
    get: function(id){
      //  summary:
      //    Return a (cached) object from the Lightstreamer.
      //  id: String
      //    The identity of the object to retrieve.
      return this.data.item(id);
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

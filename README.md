# LightstreamerStore 1.1 for Dojo
This package is designed to integrate the Lightstreamer libraries with the dojo.store APIs. This object-based store is written so that the query method returns an observable QueryResults object; all you need to do is attach a callback function to the "observe" method of the results to listen for any updates from the server. Each object returned by the server is passed to anything assigned to the "observe" function, which makes it simple to consume.

# Requisites
Note that the Lightstreamer libraries are not included as dependencies of the LightstreamerStore but are necessary in order to create an instance of LightstreamerStore. You should download the Lightstreamer libraries from the [Lightstreamer website](http://www.lightstreamer.com/download.htm) and include them in the application that is going to use the LightstreeamerStore.

# Download
You can download this package from the [Dojo foundation package repository](http://packages.dojofoundation.org/list.html).

# License
AFL or BSD license

# Lightstreamer Compatibility Notes

Compatible with Lightstreamer JavaScript Client 6.1
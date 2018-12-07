'use strict';
//app dependencies
const express = require('express');
const superagent = require('superagent');
const cors = require('cors');
const pg = require('pg');

//dotenv - load enviormental variables
require('dotenv').config();

//app constants
const app = express();
const PORT = process.env.PORT || 3000;

//Set up Database
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('err', err => console.log(err));

//Cors stuff
app.use(cors());

//handle requests
app.get('/location', getLocation);
app.get('/weather', getWeather);
app.get('/yelp', getYelp);
app.get('/movies', getMovies);
//handle errors
function handleError(err, res) {
  console.error(err);
  if (res) res.status(500).send('Sorry - Something Broke');
}

// start the server
app.listen(PORT, () => {
  console.log(`listening on ${PORT}`);
});

//pull from cache or make request
//location
function getLocation(request, response) {
  const locationHandler = {
    query: request.query.data,
    cacheHit: results => {
      console.log('Got data from SQL');
      response.send(results.rows[0]);
    },
    cacheMiss: () => {
      Location.fetchLocation(request.query.data).then(data =>
        response.send(data)
      );
    }
  };
  Location.lookupLocation(locationHandler);
}
//constructor
function Location(query, data) {
  this.search_query = query;
  this.formatted_query = data.formatted_address;
  this.latitude = data.geometry.location.lat;
  this.longitude = data.geometry.location.lng;
}

//save to database method
Location.prototype.save = function() {
  let SQL = `
  INSERT INTO locations
    (search_query,formatted_query,latitude,longitude)
    VALUES($1,$2,$3,$4)
    RETURNING id
  `;
  let values = Object.values(this);
  return client.query(SQL, values);
};

//fetch the location from api save it to the db
Location.fetchLocation = query => {
  const _URL = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${
    process.env.GEOCODE_API_KEY
  }`;
  return superagent.get(_URL).then(data => {
    console.log('Got data from API');
    if (!data.body.results.length) {
      throw 'No Data';
    } else {
      let location = new Location(query, data.body.results[0]);
      return location.save().then(result => {
        location.id = result.rows[0].id;
        return location;
      });
      return location;
    }
  });
};

//lookup location from db fucntion
Location.lookupLocation = handler => {
  const SQL = `Select * FROM locations WHERE search_query=$1`;
  const values = [handler.query];

  return client
    .query(SQL, values)
    .then(results => {
      if (results.rowCount > 0) {
        handler.cacheHit(results);
      } else {
        handler.cacheMiss();
      }
    })
    .catch(console.error);
};

//Weather functions
function getWeather(request, response) {
  const handler = {
    location: request.query.data,
    cacheHit: function(result) {
      response.send(result.rows);
    },
    cacheMiss: function() {
      Weather.fetch(request.query.data)
        .then(result => response.send(result))
        .catch(console.error);
    }
  };
  Weather.lookup(handler);
}

function Weather(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toDateString();
}

Weather.prototype.save = function(id) {
  const SQL = `INSERT INTO weathers (forecast, time, location_id) VALUES ($1, $2, $3);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

Weather.lookup = function(handler) {
  const SQL = `SELECT * FROM weathers WHERE location_id=$1;`;
  client
    .query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        console.log('Got data from SQL');
        handler.cacheHit(result);
      } else {
        console.log('Got data from API');
        handler.cacheMiss();
      }
    })
    .catch(error => handleError(error));
};

Weather.fetch = function(location) {
  const url = `https://api.darksky.net/forecast/${
    process.env.WEATHER_API_KEY
  }/${location.latitude},${location.longitude}`;

  return superagent.get(url).then(result => {
    const weatherSummaries = result.body.daily.data.map(day => {
      const summary = new Weather(day);
      summary.save(location.id);
      return summary;
    });
    return weatherSummaries;
  });
};

//Yelp functions
//pull from cache or make requests
function getYelp(request, response) {
  const handler = {
    location: request.query.data,
    cacheHit: function(result) {
      response.send(result.rows);
    },
    cacheMiss: function() {
     Restaurant.fetch(request.query.data)
        .then(result => {
            response.send(result);
        })
        .catch(console.error);
    },
  };
  Restaurant.lookup(handler);
}

//constructor function
function Restaurant(data) {
  this.name = data.name;
  this.image_url = data.image_url;
  this.price = data.price;
  this.rating = data.rating;
  this.url = data.url;
}

//save db method
Restaurant.prototype.save = function(id) {
  const SQL = `INSERT INTO restaurants (name,image_url,price,rating,url,location_id) VALUES ($1, $2, $3, $4, $5, $6);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};
//fetch api data and send to db
Restaurant.lookup = function(handler) {
  const SQL = `SELECT * FROM restaurants WHERE location_id=$1`;
  client
    .query(SQL, [handler.location.id])
    .then(result => {
      if (result.rowCount > 0) {
        console.log('Got data from SQL');
        handler.cacheHit(result);
      } else {
        console.log('Got data from API');
        handler.cacheMiss();
      }
    })
    .catch(error => handleError(error));
};
//look up restaurants
Restaurant.fetch = function(location) {
  return superagent.get(
    `https://api.yelp.com/v3/businesses/search?location=${location.search_query}/${location.latitude},${location.longitude}`)
    .set('Authorization', `Bearer ${process.env.YELP_API_KEY}`)
    .then(result => {
      const yelpSummaries = result.body.businesses.map(data => {
        const summary = new Restaurant(data);
        summary.save(location.id);
        return summary;
      });
      return yelpSummaries;    
    });
};


//Movie Functions
function getMovies(request, response) {
    const handler = {
        location: request.query.data,
        cacheHit: function(result) {
            response.send(result.rows);

        },
        cacheMiss: function (){
            Movies.fetch(request.query.data)
                .then(result => response.send(result))
                .catch(console.error);
        }
    };
    Movies.lookup(handler);
}

function Movies(data) {
  this.title = data.title;
  this.overview = data.overview;
  this.average_votes = data.vote_average;
  this.total_votes = data.vote_count;
  this.image_url =
    'https://image.tmdb.org/t/p/w370_and_h556_bestv2/' + data.poster_path;
  this.popularity = data.popularity;
  this.released_on = data.release_date;
}
Movies.prototype.save = function(id) {
    const SQL = `INSERT INTO movies (title,overview,average_votes,total_votes,image_url,popularity,released_on,location_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`;
    const values = Object.values(this);
    values.push(id);
    client.query(SQL, values);
};

Movies.lookup = function(handler) {
    const SQL = `Select * From movies WHERE location_id=$1`;
    client.query(SQL, [handler.location.id])
    .then(result => {
        if (result.rowCount >0){
            console.log('Got data from SQL');
            handler.cacheHit(result);
        } else {
            console.log('Got data from API');
            handler.cacheMiss();
        }
    })
    .catch(error => handleError(error));
};

Movies.fetch = function(location) {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.TMDB_API_KEY}&query=${location.search_query}`

    return superagent.get(url).then(result => {
        const movieSummaries = result.body.results.map(data=>{
            const summary = new Movies(data);
            summary.save(location.id);
            return summary;
        });
        return movieSummaries;
    })
}
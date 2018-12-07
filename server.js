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
app.get('/meetups', getMeetUp);
app.get('/trails', getTrail);

//handle errors
function handleError(err, res) {
  console.error(err);
  if (res) res.status(500).send('Sorry - Something Broke');
}

//delete function
function deleteByLocationId(table, city) {
  const SQL = `DELETE from ${table} WHERE location_id=${city};`;
  return client.query(SQL);
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
Location.prototype.save = function () {
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

Weather.deleteByLocationId = deleteByLocationId;

//Weather functions
function getWeather(request, response) {
  const handler = {
    location: request.query.data,
    cacheHit: function (result) {
      console.log('cacheHit is firing');
      let ageOfResultsInMinutes = (Date.now() - result.rows[0].created_at) / (1000 * 60);
      if (ageOfResultsInMinutes > 1) {
        console.log('going to delete');
        Weather.deleteByLocationId(Weather.tableName, request.query.data.id);
        this.cacheMiss();
      } else {
        console.log('keeping results');
        response.send(result.rows);
      }
    },
    cacheMiss: function () {
      console.log('cacheMiss is firing')
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
  this.created_at = Date.now();
}

Weather.prototype.save = function (id) {
  const SQL = `INSERT INTO weathers (forecast, time, created_at, location_id) VALUES ($1, $2, $3, $4);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

Weather.lookup = function (handler) {
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

Weather.fetch = function (location) {
  const url = `https://api.darksky.net/forecast/${
    process.env.WEATHER_API_KEY
    }/${location.latitude},${location.longitude}`;

  return superagent.get(url).then(result => {
    const weatherSummaries = result.body.daily.data.map(day => {
      const summary = new Weather(day);
      summary.save(location.id);
      return summary;
    });
    console.log('fetch ran');
    return weatherSummaries;
  });
};

//Yelp functions
//pull from cache or make requests
function getYelp(request, response) {
  const handler = {
    location: request.query.data,
    cacheHit: function (result) {
      response.send(result.rows);
    },
    cacheMiss: function () {
      Restaurant.fetch(request.query.data)
        .then(result => {
          response.send(result);
        })
        .catch(console.error);
    }
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
  this.created_at = Date.now();
}


//save db method
Restaurant.prototype.save = function (id) {
  const SQL = `INSERT INTO restaurants (name,image_url,price,rating,url,created_at,location_id) VALUES ($1, $2, $3, $4, $5, $6,$7);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};
//fetch api data and send to db
Restaurant.lookup = function (handler) {
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
Restaurant.fetch = function (location) {
  return superagent
    .get(
      `https://api.yelp.com/v3/businesses/search?location=${
      location.search_query
      }/${location.latitude},${location.longitude}`
    )
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
    cacheHit: function (result) {
      response.send(result.rows);
    },
    cacheMiss: function () {
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
  this.created_at = Date.now();
}
Movies.prototype.save = function (id) {
  const SQL = `INSERT INTO movies (title,overview,average_votes,total_votes,image_url,popularity,released_on,created_at,location_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

Movies.lookup = function (handler) {
  const SQL = `Select * From movies WHERE location_id=$1`;
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

Movies.fetch = function (location) {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${
    process.env.TMDB_API_KEY
    }&query=${location.search_query}`;

  return superagent.get(url).then(result => {
    const movieSummaries = result.body.results.map(data => {
      const summary = new Movies(data);
      summary.save(location.id);
      return summary;
    });
    return movieSummaries;
  });
};

//Meet up functions

function getMeetUp(request, response) {
  const handler = {
    location: request.query.data,
    cacheHit: function (result) {
      response.send(result.rows);
    },
    cacheMiss: function () {
      MeetUps.fetch(request.query.data)
        .then(result => response.send(result))
        .catch(console.error);
    }
  };
  MeetUps.lookup(handler);
}

function MeetUps(data) {
  this.link = data.link;
  this.name = data.name;
  this.creation_date = new Date(data.created * 1000).toDateString();
  this.host = data.organizer.name;
  this.created_at = Date.now();
}

MeetUps.prototype.save = function (id) {
  //TODO write save function
  const SQL = `INSERT INTO meetups (link,name,creation_date,host,created_at,location_id) VALUES ($1, $2, $3, $4, $5, $6);`;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};

MeetUps.lookup = function (handler) {
  const SQL = `Select * From meetups WHERE location_id=$1`;
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

MeetUps.fetch = function (location) {
  const url = `https://api.meetup.com/find/groups?sign=true&photo-host=public&location=${
    location.search_query
    }&page=20&key=${process.env.MEETUP_API_KEY}`;

  return superagent.get(url).then(result => {
    const meetupSummaries = result.body.map(data => {
      const summary = new MeetUps(data);
      summary.save(location.id);
      return summary;
    });
    return meetupSummaries;
  });
};

//trails functions
function getTrail(request, response) {
  const handler = {
    location: request.query.data,
    cacheHit: function (result) {
      response.send(result.rows);
    },
    cacheMiss: function () {
      Trail.fetch(request.query.data)
        .then(result => response.send(result))
        .catch(error => handleError(error));
    }
  };
  Trail.lookup(handler);
}

function Trail(data) {
  this.name = data.name;
  this.location = data.location;
  this.length = data.length + ' miles';
  this.stars = data.stars;
  this.star_votes = data.star_votes;
  this.summary = data.summary;
  this.trail_url = data.url;
  this.conditions = data.conditionStatus;
  // let conditionsArrary = data.conditionDate.split(' ');
  this.condition_date = data.conditionsDate;
  this.condiion_time = data.conditionsDate;
  this.created_at = Date.now();
}

Trail.lookup = function (handler) {
  const SQL = `SELECT * FROM trails WHERE location_id=$1;`;
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

Trail.fetch = function (location) {
  const url = `https://www.hikingproject.com/data/get-trails?key=${process.env.TRAIL_API_KEY}&lat=${location.latitude}&lon=${location.longitude}&maxDistance=10`

  return superagent.get(url).then(result => {
    const trailSummaries = result.body.trails.map(day => {
      const summary = new Trail(day);
      summary.save(location.id);
      return summary;
    });
    return trailSummaries;
  });
};

Trail.prototype.save = function (id) {
  const SQL = `
  INSERT INTO trails
    (name,location,length,stars,star_votes,summary,trail_url,conditions,condition_date,condition_time,created_at,location_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
  `;
  const values = Object.values(this);
  values.push(id);
  client.query(SQL, values);
};
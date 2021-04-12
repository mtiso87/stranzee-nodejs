require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());
const { User, Strangee } = require(__dirname + "/schema.js");

const saltRounds = 10;
const FIND_STRANGEE_PAGINATION = 30;
const FIND_STRANGEE_AGE_RADIUS = 10 * 365 * 86400 * 1000;

mongoose.connect("mongodb://localhost:27017/strangeeDB", {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  useCreateIndex: true,
});

app.post("/check_registration", (req, res) => {
  let result = false;

  User.findOne({ email: req.body.email })
    .exec()
    .then((user) => {
      console.log(user);
      if (user) result = true;

      return res.status(200).json({
        user_exists: result,
      });
    });
});

app.post("/signup", (req, res) => {
  console.log(req.body);

  if (req.body.password.length < 6) {
    return res.status(500).json({
      error: "Password must be 6 characters or more",
    });
  }

  User.find({ email: req.body.email })
    .exec()
    .then((user) => {
      if (user.length >= 1) {
        return res.status(409).json({
          message: "Email already exists",
        });
      } else {
        bcrypt.hash(req.body.password, saltRounds, (err, hash) => {
          if (err) {
            return res.status(500).json({
              error: err,
            });
          } else {
            const user = new User({
              _id: new mongoose.Types.ObjectId(),
              email: req.body.email,
              password: hash,
              firstName: req.body.firstName,
              lastName: req.body.lastName,
              imageUrl: req.body.imageUrl,
              country: req.body.country,
              gender: req.body.gender,
              interestedIn: req.body.interestedIn,
              interestedInCaps: req.body.interestedIn.map(interest => interest.toUpperCase()),
              birthday: req.body.birthday,
              aboutMe: req.body.aboutMe,
            });

            user
              .save()
              .then((result) => {
                console.log(result);
                result.password = undefined;
                result.interestedInCaps = undefined;

                const token = jwt.sign(
                  {
                    _id: result._id,
                    email: result.email,
                  },
                  process.env.JWT_KEY,
                  {
                    expiresIn: "90d",
                  }
                );

                return res.status(201).json({
                  message: "User created",
                  data: result,
                  token: token,
                });
              })
              .catch((err) => {
                console.log(err);
                res.status(500).json({
                  error: err,
                });
              });
          }
        });
      }
    });
});

app.post("/login", (req, res) => {
  User.find({ email: req.body.email })
    .exec()
    .then((users) => {
      if (users.length < 1) {
        return res.status(401).json({
          message: "Authentication failed",
        });
      }

      bcrypt.compare(req.body.password, users[0].password, (err, result) => {
        if (err) {
          return res.status(401).json({
            message: "Authentication failed",
          });
        }
        if (result) {
          users[0].password = undefined;

          const token = jwt.sign(
            {
              _id: users[0]._id,
              email: users[0].email,
            },
            process.env.JWT_KEY,
            {
              expiresIn: "90d",
            }
          );

          return res.status(200).json({
            message: "Authentication successful",
            data: users[0],
            token: token,
          });
        }
        return res.status(401).json({
          message: "Authentication failed",
        });
      });
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        error: err,
      });
    });
});

function filterStrangee(filterJson1, filterJson2, req, res, callback) {
  User.find(filterJson1)
    .find(filterJson2)
    .select(
      "_id firstName lastName imageUrl country gender interestedIn birthday aboutMe"
    )
    .limit(FIND_STRANGEE_PAGINATION)
    .exec((err, users) => {
      if (err) {
        return res.status(500).json({
          error: err,
        });
      } else {
        let total_found = users.length;
        if (total_found < FIND_STRANGEE_PAGINATION) {
          if (callback) {
            callback();
          } else {
            return res.status(200).json({
              data: users,
            });
          }
        } else if (total_found >= FIND_STRANGEE_PAGINATION) {
          users.splice(
            FIND_STRANGEE_PAGINATION,
            total_found - FIND_STRANGEE_PAGINATION
          );

          return res.status(200).json({
            data: users,
          });
        }
      }
    });
}

app.get("/strangee", ensureAuthorized, async (req, res) => {
  let strangee_query = `{"$or": [`;
  req.body.interestedIn.forEach((interest, index) => {
    strangee_query += `{"interestedInCaps" : "${interest.toUpperCase()}"}`;
    if (index < req.body.interestedIn.length - 1) strangee_query += ",";
  });
  strangee_query += "]}";

  filterStrangee(
    JSON.parse(strangee_query),
    {
      _id: { $ne: req.user_unique_data._id },
      country: req.body.country,
      birthday: {
        $gte: parseInt(req.body.birthday) - FIND_STRANGEE_AGE_RADIUS,
        $lte: parseInt(req.body.birthday) + FIND_STRANGEE_AGE_RADIUS,
      },
    },
    req,
    res,
    () => {
      filterStrangee(
        {
          _id: { $ne: req.user_unique_data._id },
          birthday: {
            $gte: parseInt(req.body.birthday) - FIND_STRANGEE_AGE_RADIUS,
            $lte: parseInt(req.body.birthday) + FIND_STRANGEE_AGE_RADIUS,
          },
        },
        null,
        req,
        res,
        () => {
          filterStrangee(null, null, req, res, null);
        }
      );
    }
  );
});

app.post("/test", ensureAuthorized, (req, res) => {
  res.status(200).json({
    unique_data: req.user_unique_data,
  });
});

// Access token implemented
// Also need to implement refresh token to refresh access token without requiring user to log-out
// Tutorial: https://www.youtube.com/watch?v=mbsmsi7l3r4
function ensureAuthorized(req, res, next) {
  var bearerToken;
  var bearerHeader = req.headers["authorization"];
  if (typeof bearerHeader !== "undefined") {
    var bearerToken = bearerHeader.split(" ")[1];

    jwt.verify(bearerToken, process.env.JWT_KEY, (err, jwt_data) => {
      if (err) {
        res.status(403).json({
          error: "Requested resource is forbidden",
        });
      }

      req.user_unique_data = jwt_data;
      next();
    });
  } else {
    res.status(403).json({
      error: "Requested resource is forbidden",
    });
  }
}

process.on("uncaughtException", (err) => {
  console.log(err);
});

app.listen(process.env.PORT | 3000, () => {
  console.log("Server started at port 3000...");
});

'use strict';

var User = require('./user.model');
var Recording = require('../recording/recording.model');
var passport = require('passport');
var config = require('../../config/environment');
var jwt = require('jsonwebtoken');
var Q = require('q');
var uuid = require('node-uuid');
var validationError = function(res, err) {
  return res.json(422, err);
};

/**
 * Get list of users
 * restriction: 'admin'
 */
exports.index = function(req, res) {
  User.find({}, '-salt -hashedPassword', function (err, users) {
    if(err) return res.send(500, err);
    res.json(200, users);
  });
};

/**
 * Creates a new user
 */
exports.create = function (req, res, next) {
  var newUser = new User(req.body);
  newUser.provider = 'local';
  newUser.role = 'user';
  newUser.save(function(err, user) {
    if (err) return validationError(res, err);
    var token = jwt.sign({_id: user._id }, config.secrets.session, { expiresInMinutes: 60*5 });
    res.json({ token: token });
  });
};

/**
 * Get a single user
 */
exports.show = function (req, res, next) {
  var userId = req.params.id;

  User.findById(userId, function (err, user) {
    if (err) return next(err);
    if (!user) return res.send(401);
    res.json(user.profile);
  });
};

/**
 * Deletes a user
 * restriction: 'admin'
 */
exports.destroy = function(req, res) {
  User.findByIdAndRemove(req.params.id, function(err, user) {
    if(err) return res.send(500, err);
    return res.send(204);
  });
};

/**
 * Change a users password
 */
exports.changePassword = function(req, res, next) {
  var userId = req.user._id;
  var oldPass = String(req.body.oldPassword);
  var newPass = String(req.body.newPassword);

  User.findById(userId, function (err, user) {
    if(user.authenticate(oldPass)) {
      user.password = newPass;
      user.save(function(err) {
        if (err) return validationError(res, err);
        res.send(200);
      });
    } else {
      res.send(403);
    }
  });
};

/**
 * Get my info
 */
exports.me = function(req, res, next) {
  var userId = req.user._id;
  User.findOne({
    _id: userId
  }, '-salt -hashedPassword', function(err, user) { // don't ever give out the password or salt
    if (err) return next(err);
    if (!user) return res.json(401);
    res.json(user);
  });
};

/**
 * Changes user language preferences
 */
exports.changeUserPreferences = function(req, res, next) {
  var userId = req.user._id;
  User.findById(userId, function (err, user) {
    if (err) return next(err);
    if (!user) return res.json(500);
    user.nativeLanguage = req.native;
    user.languageLearning = req.learning;
    user.save(function(err) {
        if (err) return validationError(res, err);
        res.send(200);
    });
  });
};

/**
 * Gets suggestions for language partners
 */
 exports.getSuggestedPartners = function(req, res, next) {
  var userId = req.user._id;
  User.findById(userId, function(err, user) {
    if (err) return next(err);
    if (!user) return res.json(500);
    User.find({ nativeLanguage: user.languageLearning }, 'name languageLearning nativeLanguage',
      function(err, partners) {
        if(err) return next(err);
        res.json({partners: partners});
    });
  });
 };

/**
 * Gets user recordings
 */
 // TODO: use q promise library



exports.getUserRecordings = function(req, res, next) {
  Recording.find({ $or: [ { creator: req.user.email }, { partner: req.user.email } ] }, 'url creator partner date',
    function(err, recordings) {
      // modify recordings, then res.json & error handling
      var promises = [];
      var renaming = function(){
        recordings.forEach(function(rec){
          if (req.user.email === rec.partner) {
            promises.push(
              User.findOne({ email: rec.creator }, function(err, doc){
                console.log(doc.name);
                rec.partner = doc.name;
              }).exec()
            );

          } else {
            promises.push(
              User.findOne({ email: rec.partner }, function(err, doc){
                console.log(doc.name);
                rec.partner = doc.name;
              }).exec()
            );

          }
        });
      };
      renaming();
      Q.all(promises)
      .then(function(value){
        console.log('RECORDINGS: ' + recordings);
        console.log('EMAIL: ' + req.user.email);
        res.json({recordings: recordings});
      })
      .catch(function(err){
        return next(err);
      })
      .done();

    }
  );
};



/**
 * Creates an invitation from one user to another
 */
 exports.createInvite = function(req, res, next) {
  var userId = req.user._id;
  var invitedId = req.body.invited;
  var invitedName = req.body.invitedName;
  var inviterName = req.body.inviterName;
  User.findByIdAndUpdate(userId,
    {$push: {"invitations": {
      text: req.body.text,
      invitedId: invitedId,
      inviterId: userId,
      invitedName: invitedName,
      inviterName: inviterName
    }}},
    {safe: true},
    function(err, user) {
      if (err) return next(err);
      if (!user) return res.json(500);
      User.findByIdAndUpdate(invitedId,
       {$push: {"invitations": {
        text: req.body.text,
        invitedId: invitedId,
        inviterId: userId,
        invitedName: invitedName,
        inviterName: inviterName
       }}},
       {safe: true},
       function(err, user) {
        if (err) return next(err);
        if (!user) return res.json(500);
        res.send(200);
      });
  });
 };

/**
 * Gets all invites that were sent to the logged in user from other users
 */
 exports.getInvites = function(req, res, next) {
  var userId = req.user._id;
  User.findById(userId, function(err, user) {
    if (err) return next(err);
    if (!user) return res.json(500);
    var invites = [];
    for(var i = 0; i < user.invitations.length; i++) {
      if(user.invitations[i].invitedId = userId) {
        invites.push(user.invitations[i]);
      }
    }
    res.json({invitations: user.invitations});
  });
};

/**
 * Gets all invites that were sent to the logged in user from other users
 */
exports.updateInvite = function(req, res, next) {
  var inviteId = req.body.inviteId;
  var inviterId = req.body.inviterId;
  var invitedId = req.body.invitedId;
  var roomId = uuid.v4();
  User.findById(inviterId, function(err, user) {
    if (err) return next(err);
    if (!user) return res.json(500);
    for(var i = 0; i < user.invitations.length; i++) {
      if(user.invitations[i]._id = inviteId) {
        user.invitations[i].room = roomId;
      }
    }
    user.save(function(err, user) {
      console.log(user);
     User.findById(invitedId, function(err, user) {
        if (err) return next(err);
        if (!user) return res.json(500);
        for(var i = 0; i < user.invitations.length; i++) {
          if(user.invitations[i]._id = inviteId) {
            user.invitations[i].room = roomId;
          }
        }
        user.save(function(err, user) {
          console.log(user);
          res.send(201);
        });
      });
    });
  });
};

/**
 * Get the user meetups that have been agreed to and have a room assigned
 */

 exports.getMeetups = function(req, res, next) {
  var userId = req.user._id;
  User.findById(userId, function(err, user) {
    if(err) return next(err);
    if (!user) return res.json(500);
    var activeMeetups = [] // each meetup (invitation) that has a room will be pushed here
    for(var i = 0; i < user.invitations.length; i++) {
      if(user.invitations[i].room) {
        activeMeetups.push(user.invitations[i]);
      }
    }
    res.json({meetups: activeMeetups});
  });
 };

/**
 * Authentication callback
 */
exports.authCallback = function(req, res, next) {
  res.redirect('/');
};

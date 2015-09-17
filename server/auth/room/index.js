'use strict';

var express = require('express');
var router = express.Router();
var auth = require('../auth.service.js');
var Partnership = require('../../api/partnership/partnership.model');
var mongoose = require('mongoose');

router.post('/', auth.isAuthenticated(), function(req, res) {
  
  // convert partnershipId string to Mongoose object id
  var partnershipId = mongoose.Types.ObjectId(req.body.partnership_id);
  var userId = mongoose.Types.ObjectId(req.user._id);

  Partnership.findById(partnershipId, function(err, partnership) {
    if(err) { return res.json(404); }

    // double check that one of the user ids of the partnership match the id of the requesting user
    if(partnership.recipient.equals(userId) || partnership.requester.equals(userId)) {
      if(partnership.requester.equals(userId)) {
        return res.json({partnerId: partnership.recipient});
      } else {
        return res.json({partnerId: partnership.requester});
      }
    } else {
      return res.json(404);
    }
  })

});

module.exports = router;
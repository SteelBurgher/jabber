'use strict';

var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var RecordingSchema = new Schema({
  filename: String,
  creator: {type: Schema.ObjectId, ref: 'User'},
  partner: {type: Schema.ObjectId, ref: 'User'},
  date: {type: Date}
});

module.exports = mongoose.model('Recording', RecordingSchema);
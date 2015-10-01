'use strict';

angular.module('jabbrApp')
  .controller('RecordingsCtrl', function ($scope, $sce, $http, Auth, Recording,
                                          User, $stateParams) {
    // TODO: query Recordings collection for 
    //   audio associated with the current user
    var ws = new WebSocket('ws://' + location.host + '/play');

    $scope.userRecordings = [];
    // ==========

    $http.get('/api/users/' + $scope.currentUser._id + '/recordings')
      .success(function(recordings, status) {
        $scope.userRecordings = recordings;
      }).error(function(error) {
        console.log(error);
    });

    $scope.parseDate = function(unixDate) {
      var foo = new Date(unixDate);
      return foo.toLocaleDateString();
    };

    $scope.parseTime = function(unixDate) {
      var foo = new Date(unixDate);
      return foo.toLocaleTimeString();
    };    
    
    $scope.audioUrl = function(filename) {
      return 'http://' + location.host + '/' + $scope.currentUser._id + '-' + filename + '.webm';
    };
  })

  .controller('RecordingCtrl', function ($scope, Auth, Recording,
                                         $stateParams, Audio) {
    $scope.userRecordings = [];
    $scope.Audio = Audio;

    // ==========
    // use $stateParams.recordingId
    Recording.get({ id: $stateParams.recordingId }, function(res) {
      $scope.userRecordings = [res];
    });
  


    $scope.parseTime = function(unixDate) {
      var foo = new Date(unixDate);
      return foo.toLocaleTimeString();
    };    

    $scope.parseDate = function(unixDate) {
      var foo = new Date(unixDate);
      return foo.toLocaleDateString();
    };
    
    
    $scope.audioUrl = function(filename) {
      return 'http://' + location.host + '/' + filename + '.webm';
    };

});

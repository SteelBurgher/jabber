'use strict';

angular.module('jabbrApp')
  .controller('InboxCtrl', function ($scope, $http) {
    $scope.messages = [];

    $http.get('api/users/invitations')
      .success(function(data, status){
        $scope.messages = data.invitations;
      })
      .error(function(error) {
        console.log(error);
      });

    $scope.acceptInvite = function(invite) {
      $http.put('api/users/invitations', {
          inviteId: invite._id,
          invitedId: invite.invitedId,
          inviterId: invite.inviterId
        })
        .success(function(data, status) {
          console.log("accepted");
        })
        .error(function(error) {
          console.log(error);
        });
    };

  });
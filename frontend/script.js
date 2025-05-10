document.getElementById('joinButton').addEventListener('click', () => {
  const roomId = document.getElementById('roomId').value.trim();
  const userId = document.getElementById('userId').value.trim();
  if (roomId && userId) {
    window.location.href = `video-call.html?roomId=${encodeURIComponent(roomId)}&userId=${encodeURIComponent(userId)}`;
  } else {
    alert('Please enter both User ID and Room ID');
  }
});
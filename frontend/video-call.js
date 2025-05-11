const socket = io(`http://${window.location.hostname}:5000`, {
  transports: ['websocket', 'polling']
});// Replace with your laptop's IP
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('roomId') || 'default-room';
const userId = urlParams.get('userId') || `User_${Math.random().toString(36).substring(7)}`;
let localStream = null;
let peerConnection = null;
let transcriptions = [];
let isMuted = false;
let isVideoOn = true;
let recognition = null;
let recognitionError = false;
let restartTimeout = null;

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const localLabel = document.getElementById('localLabel');
const remoteLabel = document.getElementById('remoteLabel');
const transcriptionDiv = document.getElementById('transcription');
const notificationDiv = document.getElementById('notification');
const muteButton = document.getElementById('muteButton');
const videoButton = document.getElementById('videoButton');
const hangupButton = document.getElementById('hangupButton');
const saveButton = document.getElementById('saveTranscription');

localLabel.textContent = `Local Video (${userId})`;
remoteLabel.textContent = 'Remote Video';

function showNotification(message, type = 'info') {
  console.log(`Notification: ${message} (${type})`);
  notificationDiv.textContent = message;
  notificationDiv.className = `notification ${type}`;
  setTimeout(() => {
    notificationDiv.textContent = '';
    notificationDiv.className = 'notification';
  }, 5000);
}

async function setupMediaStream() {
  try {
    console.log('Requesting media stream...');
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    console.log('Media stream acquired:', localStream);
    localVideo.srcObject = localStream;
    showNotification('Camera and microphone accessed', 'success');
    return true;
  } catch (error) {
    console.error('Error accessing media devices:', error.name, error.message);
    if (error.name === 'NotAllowedError') {
      showNotification('Camera/microphone access denied. Please allow permissions.', 'error');
    } else if (error.name === 'NotFoundError') {
      showNotification('No camera/microphone found. Check your device.', 'error');
    } else {
      showNotification(`Failed to access camera/microphone: ${error.message}`, 'error');
    }
    return false;
  }
}

function createPeerConnection() {
  console.log('Creating peer connection...');
  peerConnection = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  });

  peerConnection.onicecandidate = event => {
    if (event.candidate) {
      console.log('Sending ICE candidate:', event.candidate);
      socket.emit('ice-candidate', roomId, event.candidate, userId);
    }
  };

  peerConnection.ontrack = event => {
    console.log('Received remote stream:', event.streams[0]);
    remoteVideo.srcObject = event.streams[0];
    showNotification('Connected to remote user', 'success');
  };

  peerConnection.onconnectionstatechange = () => {
    console.log('Peer connection state:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'failed') {
      showNotification('Connection failed. Please try again.', 'error');
      peerConnection.close();
      createPeerConnection();
      initiateCall();
    } else if (peerConnection.connectionState === 'disconnected') {
      showNotification('Remote user disconnected.', 'info');
    }
  };

  if (localStream) {
    localStream.getTracks().forEach(track => {
      console.log('Adding track:', track.kind, track.id);
      peerConnection.addTrack(track, localStream);
    });
  } else {
    console.error('No local stream to add tracks from');
  }
}

async function initiateCall() {
  try {
    console.log('Initiating call...');
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    console.log('Sending offer:', offer);
    socket.emit('offer', roomId, offer, userId);
  } catch (error) {
    console.error('Error initiating call:', error);
    showNotification('Error starting call', 'error');
  }
}

async function handleOffer(offer, otherUserId) {
  try {
    console.log('Received offer from', otherUserId);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    console.log('Sending answer:', answer);
    socket.emit('answer', roomId, answer, userId);
  } catch (error) {
    console.error('Error handling offer:', error);
    showNotification('Error establishing connection', 'error');
  }
}

async function handleAnswer(answer, otherUserId) {
  try {
    console.log('Received answer from', otherUserId);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
  } catch (error) {
    console.error('Error handling answer:', error);
    showNotification('Error finalizing connection', 'error');
  }
}

async function handleIceCandidate(candidate, otherUserId) {
  try {
    console.log('Received ICE candidate from', otherUserId);
    await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
  } catch (error) {
    console.error('Error adding ICE candidate:', error);
  }
}

function startTranscription() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    transcriptionDiv.innerHTML = 'Speech Recognition not supported. Use Chrome.';
    showNotification('Subtitles not supported in this browser', 'error');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = event => {
    let interim = '';
    let final = '';
    for (let i = 0; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final = transcript;
        console.log(`Final transcript from ${userId}: ${final}`);
        socket.emit('transcript', roomId, userId, final, true);
        transcriptions.push(`${userId}: ${final}`);
      } else {
        interim = transcript;
      }
    }
    updateTranscriptionDisplay(interim);
  };


  recognition.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    showNotification(`Subtitles error: ${event.error}`, 'error');
    recognitionError = true;
  };

  recognition.onend = () => {
    if (!recognitionError) {
      console.log("Speech recognition ended, scheduling restart...");
      if (restartTimeout) clearTimeout(restartTimeout);

      // Delay restart to prevent infinite rapid loops
      restartTimeout = setTimeout(() => {
        try {
          recognition.start();
          console.log('Speech recognition restarted');
        } catch (error) {
          console.error('Error restarting recognition:', error);
          showNotification('Failed to restart subtitles', 'error');
        }
      }, 1000); // 1-second delay to avoid rapid restart loops
    } else {
      console.log("Speech recognition aborted due to error");
    }
  };

  try {
    recognition.start();
    console.log('Speech recognition started');
  } catch (error) {
    console.error('Error starting speech recognition:', error);
    showNotification('Failed to start subtitles', 'error');
  }
}

function updateTranscriptionDisplay(interim = '') {
  const finalTranscriptions = transcriptions.map(text => `<p>${text}</p>`).join('');
  const interimText = interim ? `<p class="interim">${userId}: ${interim}</p>` : '';
  transcriptionDiv.innerHTML = finalTranscriptions + interimText;
  transcriptionDiv.scrollTop = transcriptionDiv.scrollHeight;
}

async function init() {
  // Check media devices availability
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    console.log('Available devices:', devices);
    const videoDevices = devices.filter(device => device.kind === 'videoinput');
    const audioDevices = devices.filter(device => device.kind === 'audioinput');
    if (videoDevices.length === 0 || audioDevices.length === 0) {
      showNotification('No camera or microphone detected.', 'error');
      return;
    }
  } catch (error) {
    console.error('Error enumerating devices:', error);
    showNotification('Error checking devices.', 'error');
    return;
  }

  const mediaSuccess = await setupMediaStream();
  if (!mediaSuccess) return;

  createPeerConnection();
  socket.emit('join-room', roomId, userId);
  startTranscription();
}

socket.on('room-users', users => {
  console.log('Users in room:', users);
  showNotification(`Users in room: ${users.join(', ')}`, 'info');
});

socket.on('user-connected', otherUserId => {
  if (otherUserId !== userId) {
    remoteLabel.textContent = `Remote Video (${otherUserId})`;
    console.log(`${otherUserId} joined the call`);
    initiateCall();
    showNotification(`${otherUserId} joined the call`, 'info');
  }
});

socket.on('offer', (offer, otherUserId) => {
  if (otherUserId !== userId) {
    remoteLabel.textContent = `Remote Video (${otherUserId})`;
    handleOffer(offer, otherUserId);
  }
});

socket.on('answer', (answer, otherUserId) => {
  if (otherUserId !== userId) {
    handleAnswer(answer, otherUserId);
  }
});

socket.on('ice-candidate', (candidate, otherUserId) => {
  if (otherUserId !== userId) {
    handleIceCandidate(candidate, otherUserId);
  }
});

socket.on('user-disconnected', otherUserId => {
  if (otherUserId !== userId) {
    remoteVideo.srcObject = null;
    remoteLabel.textContent = 'Remote Video';
    console.log(`${otherUserId} left the call`);
    showNotification(`${otherUserId} left the call`, 'info');
  }
});

socket.on('transcript', (fromUserId, transcript, isFinal) => {
  console.log(`Received transcript from ${fromUserId}: ${transcript} (isFinal: ${isFinal})`);
  if (isFinal) {
    transcriptions.push(`${fromUserId}: ${transcript}`);
    updateTranscriptionDisplay();
  } else {
    updateTranscriptionDisplay(`${fromUserId}: ${transcript}`);
  }
});

muteButton.addEventListener('click', () => {
  if (!localStream) {
    console.error('No local stream available to mute');
    showNotification('No stream available', 'error');
    return;
  }

  isMuted = !isMuted;
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    audioTrack.enabled = !isMuted;
    console.log(`Mute toggled: Audio track enabled = ${audioTrack.enabled}`);
    muteButton.innerHTML = `<i class="icon">${isMuted ? '🔇' : '🔊'}</i> ${isMuted ? 'Unmute' : 'Mute'}`;
    muteButton.classList.toggle('btn-active', isMuted);
    showNotification(isMuted ? 'Microphone muted' : 'Microphone unmuted', 'info');
  } else {
    console.error('No audio track available');
    showNotification('No audio track found', 'error');
  }
});

videoButton.addEventListener('click', () => {
  if (!localStream) {
    console.error('No local stream available to toggle video');
    showNotification('No stream available', 'error');
    return;
  }

  isVideoOn = !isVideoOn;
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = isVideoOn;
    console.log(`Video toggled: Video track enabled = ${videoTrack.enabled}`);
    videoButton.innerHTML = `<i class="icon">${isVideoOn ? '📹' : '📷'}</i> ${isVideoOn ? 'Video On' : 'Video Off'}`;
    videoButton.classList.toggle('btn-active', !isVideoOn);
    showNotification(isVideoOn ? 'Video enabled' : 'Video disabled', 'info');
  } else {
    console.error('No video track available');
    showNotification('No video track found', 'error');
  }
});

hangupButton.addEventListener('click', () => {
  console.log('Hangup clicked');
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
    console.log('Peer connection closed');
  }

  if (localStream) {
    localStream.getTracks().forEach(track => {
      track.stop();
      console.log(`Stopped track: ${track.kind}, ${track.id}`);
    });
    localStream = null;
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
  }

  if (recognition) {
    recognition.stop();
    console.log('Speech recognition stopped');
  }

  socket.disconnect();
  console.log('Socket disconnected');
  showNotification('Call ended', 'info');
  window.location.href = 'index.html';
});

saveButton.addEventListener('click', () => {
  if (transcriptions.length === 0) {
    showNotification('No subtitles to save', 'error');
    return;
  }
  const blob = new Blob([transcriptions.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `subtitles_${roomId}_${new Date().toISOString()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showNotification('Subtitles saved', 'success');
});

init();
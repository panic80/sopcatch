// Popup script to handle user interactions and display status

let recordingStartTime = null;
let durationInterval = null;

// DOM Elements
const startButton = document.getElementById('startRecording');
const stopButton = document.getElementById('stopRecording');
const recordingStatus = document.getElementById('recordingStatus');
const durationElement = document.getElementById('duration');
const stepCountElement = document.getElementById('stepCount');
const viewSessionsButton = document.getElementById('viewSessions');
const sessionsList = document.getElementById('sessionsList');
const sessionsContainer = document.getElementById('sessionsContainer');
const openOptionsButton = document.getElementById('openOptions');

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  updateRecordingStatus();
  setupEventListeners();
});

// Set up event listeners
function setupEventListeners() {
  startButton.addEventListener('click', startRecording);
  stopButton.addEventListener('click', stopRecording);
  viewSessionsButton.addEventListener('click', toggleSessionsList);
  openOptionsButton.addEventListener('click', openOptions);
}

// Start recording
async function startRecording() {
  // Notify background script
  chrome.runtime.sendMessage({ type: 'START_SESSION' });
  
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // Notify content script
  chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING' });
  
  // Update UI
  startButton.disabled = true;
  stopButton.disabled = false;
  recordingStatus.textContent = 'Recording';
  recordingStatus.classList.add('recording');
  
  // Start duration timer
  recordingStartTime = Date.now();
  startDurationTimer();
}

// Stop recording
async function stopRecording() {
  // Notify background script
  chrome.runtime.sendMessage({ type: 'END_SESSION' });
  
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // Notify content script
  chrome.tabs.sendMessage(tab.id, { type: 'STOP_RECORDING' });
  
  // Update UI
  startButton.disabled = false;
  stopButton.disabled = true;
  recordingStatus.textContent = 'Not Recording';
  recordingStatus.classList.remove('recording');
  
  // Stop duration timer
  stopDurationTimer();
  
  // Refresh sessions list
  loadSessions();
}

// Update recording status
async function updateRecordingStatus() {
  const { sopData } = await chrome.storage.local.get('sopData');
  const isRecording = sopData?.currentSession != null;
  
  startButton.disabled = isRecording;
  stopButton.disabled = !isRecording;
  recordingStatus.textContent = isRecording ? 'Recording' : 'Not Recording';
  recordingStatus.classList.toggle('recording', isRecording);
  
  if (isRecording) {
    recordingStartTime = new Date(sopData.currentSession.startTime).getTime();
    startDurationTimer();
  }
}

// Timer functions
function startDurationTimer() {
  durationInterval = setInterval(updateDuration, 1000);
}

function stopDurationTimer() {
  if (durationInterval) {
    clearInterval(durationInterval);
    durationInterval = null;
  }
}

function updateDuration() {
  if (!recordingStartTime) return;
  
  const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
  const minutes = Math.floor(duration / 60).toString().padStart(2, '0');
  const seconds = (duration % 60).toString().padStart(2, '0');
  durationElement.textContent = `${minutes}:${seconds}`;
}

// Session management
async function loadSessions() {
  chrome.runtime.sendMessage({ type: 'GET_SESSIONS' }, (response) => {
    displaySessions(response.sessions);
  });
}

function displaySessions(sessions) {
  sessionsContainer.innerHTML = '';
  
  if (!sessions || sessions.length === 0) {
    sessionsContainer.innerHTML = '<p class="no-sessions">No recorded sessions</p>';
    return;
  }
  
  sessions.forEach(session => {
    const sessionElement = document.createElement('div');
    sessionElement.className = 'session-item';
    
    const startTime = new Date(session.startTime).toLocaleString();
    const duration = calculateDuration(session.startTime, session.endTime);
    const stepCount = session.steps.reduce((count, step) => count + step.interactions.length, 0);
    
    // Create session info
    const sessionInfo = document.createElement('div');
    sessionInfo.className = 'session-info';
    sessionInfo.innerHTML = `
      <span class="session-time">${startTime}</span>
      <span class="session-duration">${duration}</span>
      <span class="step-count">${stepCount} steps</span>
    `;

    // Create action buttons
    const actionButtons = document.createElement('div');
    actionButtons.className = 'session-actions';
    
    const viewButton = document.createElement('button');
    viewButton.className = 'button small primary';
    viewButton.textContent = 'View SOP';
    viewButton.addEventListener('click', () => viewSOP(session.id));
    
    const downloadButton = document.createElement('button');
    downloadButton.className = 'button small';
    downloadButton.textContent = 'Download SOP';
    downloadButton.addEventListener('click', () => exportSOP(session.id));
    
    actionButtons.appendChild(viewButton);
    actionButtons.appendChild(downloadButton);

    // Add elements to session container
    sessionElement.appendChild(sessionInfo);
    sessionElement.appendChild(actionButtons);
    
    sessionsContainer.appendChild(sessionElement);
  });
}

function calculateDuration(startTime, endTime) {
  const duration = Math.floor((new Date(endTime) - new Date(startTime)) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  return `${minutes}m ${seconds}s`;
}

// Toggle sessions list visibility
function toggleSessionsList() {
  sessionsList.classList.toggle('hidden');
  if (!sessionsList.classList.contains('hidden')) {
    loadSessions();
  }
}

// View SOP in new tab
function viewSOP(sessionId) {
  chrome.runtime.sendMessage({ type: 'VIEW_SOP', sessionId }, (response) => {
    if (response.success) {
      const blob = new Blob([response.content], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      chrome.tabs.create({ url }, () => {
        // Cleanup URL after tab is created
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    } else {
      console.error('Error viewing SOP:', response.error);
      alert('Failed to view SOP. Please try again.');
    }
  });
}

// Export SOP as downloadable file
function exportSOP(sessionId) {
  chrome.runtime.sendMessage({ type: 'EXPORT_SOP', sessionId }, (response) => {
    if (response.success) {
      // Create and trigger download
      const blob = new Blob([response.content], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = `SOP_${new Date().toISOString().split('T')[0]}.html`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      
      // Cleanup
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      console.error('Error exporting SOP:', response.error);
      alert('Failed to export SOP. Please try again.');
    }
  });
}

// Open options page
function openOptions() {
  chrome.runtime.openOptionsPage();
}

// Update step count periodically
setInterval(async () => {
  const { sopData } = await chrome.storage.local.get('sopData');
  if (sopData?.currentSession) {
    const stepCount = sopData.currentSession.steps.reduce(
      (count, step) => count + step.interactions.length,
      0
    );
    stepCountElement.textContent = stepCount;
  }
}, 1000);
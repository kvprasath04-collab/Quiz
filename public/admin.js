const socket = io();

// DOM Elements
const loginScreen = document.getElementById('admin-login-screen');
const mainUi = document.getElementById('admin-main-ui');
const passwordInput = document.getElementById('admin-password');
const loginBtn = document.getElementById('admin-login-btn');

const newQuestionInput = document.getElementById('new-question');
const askBtn = document.getElementById('ask-btn');
const questionDurationInput = document.getElementById('question-duration');
const responsesList = document.getElementById('responses-list');
const adminHistoryList = document.getElementById('admin-history-list');
const responseCountEl = document.getElementById('response-count');
const activeQuestionPanel = document.getElementById('active-question-panel');
const currentActiveQuestion = document.getElementById('current-active-question');
const adminCountdown = document.getElementById('admin-countdown');
const clearBtn = document.getElementById('clear-btn');
const exportBtn = document.getElementById('export-btn');
const exportStartInput = document.getElementById('export-start');
const exportEndInput = document.getElementById('export-end');
const deleteAllBtn = document.getElementById('delete-all-btn');
const liveUserCount = document.getElementById('live-user-count');
const openRosterBtn = document.getElementById('open-roster-btn');
const closeRosterBtn = document.getElementById('close-roster-btn');
const rosterModal = document.getElementById('roster-modal');
const rosterList = document.getElementById('roster-list');
const leaderboardList = document.getElementById('leaderboard-list');

const imagePreviewContainer = document.getElementById('image-preview-container');
const imagePreview = document.getElementById('image-preview');
const removeImageBtn = document.getElementById('remove-image-btn');
const currentActiveImage = document.getElementById('current-active-image');

let currentImageBase64 = null;

let currentResponses = [];
let adminTimerInterval = null;
let fullHistory = [];

// Authentication
loginBtn.addEventListener('click', () => {
    const pw = passwordInput.value;
    if (pw === 'Prasath_04') {
        loginScreen.style.display = 'none';
        mainUi.style.display = 'grid'; // Grid is used for admin-container

        // Initialization only after login
        socket.emit('admin_join', pw);
        socket.emit('admin_get_leaderboard', pw); // Populate the persistent leaderboard
    } else {
        alert('Incorrect password');
        passwordInput.value = '';
        passwordInput.focus();
    }
});

passwordInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loginBtn.click();
});

// Utility Functions
window.switchAdminTab = function (tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));

    event.target.classList.add('active');
    document.getElementById(`${tabName}-tab`).classList.add('active');
};

// Image Pasting Logic
newQuestionInput.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
        if (item.type.indexOf('image') === 0) {
            e.preventDefault(); // Prevent default paste if we handle it
            const file = item.getAsFile();
            const reader = new FileReader();

            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    // Compress image if it's too large
                    const canvas = document.createElement('canvas');
                    const MAX_WIDTH = 800;
                    const MAX_HEIGHT = 800;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // Get base64 string
                    currentImageBase64 = canvas.toDataURL('image/jpeg', 0.8);
                    
                    // Show preview
                    imagePreview.src = currentImageBase64;
                    imagePreviewContainer.style.display = 'block';
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    }
});

removeImageBtn.addEventListener('click', () => {
    currentImageBase64 = null;
    imagePreview.src = '';
    imagePreviewContainer.style.display = 'none';
});


function updateResponsesList() {
    responseCountEl.textContent = currentResponses.length;

    if (currentResponses.length === 0) {
        responsesList.innerHTML = '<div class="empty-state">No responses yet. Waiting for answers...</div>';
        return;
    }

    responsesList.innerHTML = '';

    // Sort so newest are on top
    const reversed = [...currentResponses].reverse();

    reversed.forEach(response => {
        const card = document.createElement('div');
        card.className = 'response-card';
        card.innerHTML = `
            <div class="response-name">${escapeHTML(response.name)}</div>
            <div class="response-text">${escapeHTML(response.answer)}</div>
            <div class="mark-btn-container">
                <button class="mark-btn correct ${response.isCorrect === true ? 'active' : ''}" 
                    onclick="markResponse('${response.responseId}', ${response.isCorrect === true ? 'null' : 'true'})">✅ Correct</button>
                <button class="mark-btn incorrect ${response.isCorrect === false ? 'active' : ''}" 
                    onclick="markResponse('${response.responseId}', ${response.isCorrect === false ? 'null' : 'false'})">❌ Incorrect</button>
            </div>
        `;
        responsesList.appendChild(card);
    });
}

window.markResponse = function (responseId, isCorrect) {
    socket.emit('admin_mark_response', {
        responseId,
        isCorrect,
        password: passwordInput.value
    });
};

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g,
        tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)
    );
}

function renderAdminHistory() {
    if (!fullHistory || fullHistory.length === 0) {
        adminHistoryList.innerHTML = '<div class="empty-state">No history recorded yet for this session.</div>';
        return;
    }

    let tableHtml = `
        <table class="data-table">
            <thead>
                <tr>
                    <th style="width: 10%;">#</th>
                    <th style="width: 30%;">Question</th>
                    <th style="width: 25%;">Student</th>
                    <th style="width: 35%;">Answer</th>
                </tr>
            </thead>
            <tbody>
    `;

    // Newest first
    const reversedHistory = [...fullHistory].reverse();

    reversedHistory.forEach((session, idx) => {
        const questionNum = fullHistory.length - idx;

        if (session.responses.length === 0) {
            const imageHtml = session.image ? `<br><img src="${session.image}" style="max-height: 100px; max-width: 100%; border-radius: 0.5rem; margin-top: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">` : '';
            tableHtml += `
            <tr>
                <td style="color: #818cf8; font-weight: 500;">Q${questionNum}</td>
                <td style="color: #e2e8f0; vertical-align: top;">${escapeHTML(session.question)}${imageHtml}</td>
                <td colspan="2" style="color: #64748b; font-style: italic;">No responses recorded</td>
            </tr>
            `;
        } else {
            session.responses.forEach((resp, rIdx) => {
                // Only print the question text on the first row for this question
                const questionText = rIdx === 0 ? escapeHTML(session.question) : '';
                const imageHtml = (rIdx === 0 && session.image) ? `<br><img src="${session.image}" style="max-height: 100px; max-width: 100%; border-radius: 0.5rem; margin-top: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">` : '';
                const qNumText = rIdx === 0 ? `Q${questionNum}` : '';

                tableHtml += `
                    <tr>
                        <td style="color: #818cf8; font-weight: 500;">${qNumText}</td>
                        <td style="color: #e2e8f0; white-space: pre-wrap; vertical-align: top;">${questionText}${imageHtml}</td>
                        <td style="color: #94a3b8;">${escapeHTML(resp.name)}</td>
                        <td style="color: #f8fafc;">
                            <div style="margin-bottom: 0.5rem; white-space: pre-wrap; word-break: break-word;">${escapeHTML(resp.answer)}</div>
                            <div class="status-badge ${resp.isCorrect === true ? 'correct' : (resp.isCorrect === false ? 'incorrect' : 'pending')}">${resp.isCorrect === true ? 'Correct' : (resp.isCorrect === false ? 'Incorrect' : 'Pending')}</div>
                        </td>
                    </tr>
                `;
            });
        }
    });

    tableHtml += `
            </tbody>
        </table>
    `;

    adminHistoryList.innerHTML = tableHtml;
}

function startAdminTimer(targetTimeServer, serverTimeOrigin) {
    clearInterval(adminTimerInterval);
    const timeOffset = Date.now() - serverTimeOrigin;
    const endTime = targetTimeServer + timeOffset;

    const updateTimer = () => {
        const now = Date.now();
        const remaining = Math.max(0, endTime - now);
        const seconds = Math.floor(remaining / 1000);

        adminCountdown.textContent = `${seconds}s remaining`;

        if (seconds <= 10) {
            adminCountdown.style.color = 'var(--error)';
        } else {
            adminCountdown.style.color = '#f1f5f9';
        }

        if (remaining <= 0) {
            clearInterval(adminTimerInterval);
            adminCountdown.textContent = 'Time Up!';
            adminCountdown.style.color = 'var(--error)';
        }
    };

    adminTimerInterval = setInterval(updateTimer, 100);
    updateTimer();
}

function setActiveQuestionState(question, image, timerEnd, serverTime) {
    activeQuestionPanel.style.display = 'block';
    currentActiveQuestion.textContent = question;

    if (image) {
        currentActiveImage.src = image;
        currentActiveImage.style.display = 'block';
    } else {
        currentActiveImage.style.display = 'none';
        currentActiveImage.src = '';
    }

    newQuestionInput.value = '';
    startAdminTimer(timerEnd, serverTime);
}

// Event Listeners (UI)
askBtn.addEventListener('click', () => {
    const question = newQuestionInput.value.trim();
    if (!question) {
        newQuestionInput.focus();
        return;
    }

    const durationSeconds = parseInt(questionDurationInput.value, 10) || 60;

    // Emit start question
    socket.emit('admin_start_question', {
        question,
        image: currentImageBase64,
        duration: durationSeconds,
        password: passwordInput.value
    });

    // Local optimisic update
    currentImageBase64 = null;
    imagePreviewContainer.style.display = 'none';
    imagePreview.src = '';
    currentResponses = [];
    updateResponsesList();
});

clearBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear the current active session?')) {
        socket.emit('admin_clear', passwordInput.value);
    }
});

deleteAllBtn.addEventListener('click', () => {
    if (confirm('WARNING: Are you sure you want to PERMANENTLY delete ALL historical records? This cannot be undone.')) {
        if (confirm('Are you absolutely certain?')) {
            socket.emit('admin_delete_all_records', passwordInput.value);
        }
    }
});

exportBtn.addEventListener('click', () => {
    let url = '/api/export';
    const params = new URLSearchParams();

    if (exportStartInput.value) params.append('start', exportStartInput.value);
    if (exportEndInput.value) params.append('end', exportEndInput.value);

    if (params.toString()) {
        url += '?' + params.toString();
    }

    window.location.href = url;
});

openRosterBtn.addEventListener('click', () => {
    rosterModal.style.display = 'flex';
});

closeRosterBtn.addEventListener('click', () => {
    rosterModal.style.display = 'none';
});

// Close modal when clicking outside of it
rosterModal.addEventListener('click', (e) => {
    if (e.target === rosterModal) {
        rosterModal.style.display = 'none';
    }
});

// Event Listeners (Socket)
socket.on('admin_init', (state) => {
    fullHistory = state.history || [];
    renderAdminHistory();

    if (state.activeQuestion) {
        setActiveQuestionState(state.activeQuestion, state.activeImage, state.timerEnd, state.serverTime);
        currentResponses = state.responses || [];
        updateResponsesList();
    }
});

socket.on('client_count', (count) => {
    if (liveUserCount) {
        liveUserCount.textContent = count;
    }
});

socket.on('roster_update', (names) => {
    if (names.length === 0) {
        rosterList.innerHTML = '<div style="color: #64748b; font-style: italic; text-align: center;">No one has joined yet.</div>';
    } else {
        rosterList.innerHTML = '';
        names.forEach(name => {
            const row = document.createElement('div');
            row.style.padding = '0.5rem 1rem';
            row.style.background = 'rgba(255, 255, 255, 0.05)';
            row.style.borderRadius = '0.5rem';
            row.style.border = '1px solid var(--glass-border)';
            row.textContent = name;
            rosterList.appendChild(row);
        });
    }
});

socket.on('new_question', (data) => {
    setActiveQuestionState(data.question, data.image, data.timerEnd, data.serverTime);
    currentResponses = [];
    updateResponsesList();

    // Update history since previous question was archived
    fullHistory = data.history || [];
    renderAdminHistory();
});

socket.on('new_response', (response) => {
    currentResponses.push(response);
    updateResponsesList();
});

socket.on('response_marked', ({ responseId, isCorrect }) => {
    // Update local state if it's in current responses
    const currentIdx = currentResponses.findIndex(r => r.responseId === responseId);
    if (currentIdx !== -1) {
        currentResponses[currentIdx].isCorrect = isCorrect;
        updateResponsesList();
    }

    // Update history state
    let historyChanged = false;
    fullHistory.forEach(session => {
        const hResp = session.responses.find(r => r.responseId === responseId);
        if (hResp) {
            hResp.isCorrect = isCorrect;
            historyChanged = true;
        }
    });

    if (historyChanged) {
        renderAdminHistory();
    }
});

socket.on('leaderboard_update', (data) => {
    renderLeaderboard(data);
});

function renderLeaderboard(data) {
    if (!data || data.length === 0) {
        leaderboardList.innerHTML = '<div class="empty-state">No scores recorded yet. Correct answers to see the rankings!</div>';
        return;
    }

    let html = `
        <table class="leaderboard-table">
            <tbody>
    `;

    data.forEach((item, idx) => {
        html += `
            <tr class="leaderboard-row">
                <td class="leaderboard-rank">#${idx + 1}</td>
                <td class="leaderboard-name">${escapeHTML(item.name)}</td>
                <td class="leaderboard-score">${item.score} Points</td>
            </tr>
        `;
    });

    html += `
            </tbody>
        </table>
    `;

    leaderboardList.innerHTML = html;
}

socket.on('session_cleared', () => {
    activeQuestionPanel.style.display = 'none';
    clearInterval(adminTimerInterval);
    currentResponses = [];
    fullHistory = [];
    updateResponsesList();
    renderAdminHistory();
});

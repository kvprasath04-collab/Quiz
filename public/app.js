const socket = io();

// State
let userName = '';
let userPhone = '';
let currentView = 'name-section';
let timerInterval = null;
let endTime = null;
let hasAnsweredCurrentQuestion = false;

// DOM Elements
const sections = {
    name: document.getElementById('name-section'),
    question: document.getElementById('question-section'),
    dashboard: document.getElementById('dashboard-layout')
};

const waitingStatus = document.getElementById('waiting-status-content');
const submittedStatus = document.getElementById('submitted-status-content');
const waitingContent = document.getElementById('waiting-content');
const submittedContent = document.getElementById('submitted-content');

const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username');
const userphoneInput = document.getElementById('userphone');
const submitBtn = document.getElementById('submit-btn');
const answerInput = document.getElementById('answer-input');
const liveQuestionEl = document.getElementById('live-question');
const liveQuestionImageEl = document.getElementById('live-question-image');

const progressBarFill = document.getElementById('progress-bar-fill');
const progressBarText = document.getElementById('progress-bar-text');

const toastReaction = document.getElementById('toast-reaction');
const toastEmoji = document.getElementById('toast-emoji');
const toastMessage = document.getElementById('toast-message');

const waitingTitle = document.getElementById('waiting-title');
const waitingMessage = document.getElementById('waiting-message');
const submittedQuestionEl = document.getElementById('submitted-question');
const submittedQuestionImageEl = document.getElementById('submitted-question-image');
const submittedAnswerEl = document.getElementById('submitted-answer');
const historyPanel = document.getElementById('history-panel');
const historyList = document.getElementById('history-list');

const studentHeader = document.getElementById('student-header');
const displayName = document.getElementById('display-name');
const studentScore = document.getElementById('student-score');

const podiumContainer = document.getElementById('podium-container');
const triviaPanel = document.getElementById('trivia-panel');
const triviaContent = document.getElementById('trivia-content');
const hypeBar = document.getElementById('hype-bar');

let triviaHints = [];
let currentTriviaIndex = 0;
let triviaInterval = null;
let lastTriviaContent = "";

function startTriviaRotation() {
    if (triviaHints.length === 0) {
        if (triviaInterval) clearInterval(triviaInterval);
        triviaPanel.style.display = 'none';
        return;
    }

    // Don't restart if already running for the exact same trivia set
    const currentSerialized = JSON.stringify(triviaHints);
    if (triviaInterval && lastTriviaContent === currentSerialized) {
        return;
    }

    // New content or first run: Reset to beginning
    lastTriviaContent = currentSerialized;
    currentTriviaIndex = 0; 
    
    if (triviaInterval) clearInterval(triviaInterval);

    triviaPanel.style.display = 'block';
    updateTriviaDisplay(); // Show index 0 immediately

    triviaInterval = setInterval(() => {
        currentTriviaIndex = (currentTriviaIndex + 1) % triviaHints.length;
        updateTriviaDisplay();
    }, 60000); // 1 minute per fact
}

function updateTriviaDisplay() {
    if (triviaHints[currentTriviaIndex]) {
        triviaContent.style.opacity = 0;
        setTimeout(() => {
            triviaContent.innerText = triviaHints[currentTriviaIndex];
            triviaContent.style.opacity = 1;
        }, 500);
    }
}

// Utility Functions
function getAvatarEmoji(str) {
    const emojis = ['🐶', '🐱', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🦄', '🐝', '🐛', '🦋', '🐢', '🐙', '🦑', '🦞', '🦖', '🦕'];
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % emojis.length;
    return emojis[index];
}

function switchView(viewName) {
    // Standard section visibility
    document.querySelectorAll('#standalone-content > div').forEach(div => div.style.display = 'none');
    sections.dashboard.style.display = 'none';

    if (viewName === 'name' || viewName === 'question') {
        sections[viewName].style.display = 'block';
    } else {
        sections.dashboard.style.display = (window.innerWidth >= 1024) ? 'grid' : 'flex';
        
        // Internal Dashboard Toggling
        waitingStatus.style.display = (viewName === 'waiting') ? 'block' : 'none';
        submittedStatus.style.display = (viewName === 'submitted') ? 'block' : 'none';
        waitingContent.style.display = (viewName === 'waiting') ? 'block' : 'none';
        submittedContent.style.display = (viewName === 'submitted') ? 'block' : 'none';
    }
    
    currentView = viewName;

    // Toggle hype bar - hide only in name entry
    if (viewName === 'name') {
        hypeBar.style.display = 'none';
    } else {
        hypeBar.style.display = 'flex';
    }

    // Toggle trivia panel
    if ((viewName === 'waiting' || viewName === 'submitted') && triviaHints.length > 0) {
        triviaPanel.style.display = 'block';
        startTriviaRotation();
    } else {
        triviaPanel.style.display = 'none';
        clearInterval(triviaInterval);
    }

    // Show history panel only after joining
    if (userName && viewName !== 'name-section') {
        historyPanel.style.display = 'block';
    } else {
        historyPanel.style.display = 'none';
    }
}

function startTimer(targetTimeServer, serverTimeOrigin) {
    clearInterval(timerInterval);

    // Calculate difference between server time and local time
    const timeOffset = Date.now() - serverTimeOrigin;

    // Local end time
    endTime = targetTimeServer + timeOffset;
    const initialRemaining = Math.max(0, endTime - Date.now());
    
    // If it's a new question, duration is around 60s. If refreshed, we use remaining.
    // For smooth visuals we use initialRemaining as the 100% width if refreshed.
    const totalDurationMs = initialRemaining > 0 ? initialRemaining : 60000;

    const updateTimer = () => {
        const now = Date.now();
        const remaining = Math.max(0, endTime - now);
        const seconds = Math.ceil(remaining / 1000);
        
        let percent = (remaining / totalDurationMs) * 100;
        if (percent < 0) percent = 0;
        if (percent > 100) percent = 100;

        progressBarFill.style.width = `${percent}%`;
        progressBarText.textContent = `${seconds}s`;

        if (seconds <= 5) {
            progressBarFill.style.backgroundColor = 'var(--error)';
            progressBarFill.style.boxShadow = '0 0 10px var(--error)';
        } else if (seconds <= 15) {
            progressBarFill.style.backgroundColor = '#f59e0b'; // warning yellow
            progressBarFill.style.boxShadow = '0 0 10px #f59e0b';
        } else {
            progressBarFill.style.backgroundColor = 'var(--success)';
            progressBarFill.style.boxShadow = '0 0 10px var(--success)';
        }

        if (remaining <= 0) {
            clearInterval(timerInterval);
            if (currentView === 'question' && !hasAnsweredCurrentQuestion) {
                const finalAnswer = answerInput.value.trim();

                if (finalAnswer) {
                    // Auto-submit whatever they typed
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Auto-submitting...';
                    answerInput.disabled = true;

                    // Add optimistic UI to the submitted view
                    submittedQuestionEl.textContent = liveQuestionEl.textContent;
                    if (liveQuestionImageEl.style.display === 'block') {
                        submittedQuestionImageEl.src = liveQuestionImageEl.src;
                        submittedQuestionImageEl.style.display = 'block';
                    } else {
                        submittedQuestionImageEl.style.display = 'none';
                        submittedQuestionImageEl.src = '';
                    }
                    submittedAnswerEl.textContent = finalAnswer;

                    socket.emit('user_submit_answer', {
                        name: userName,
                        phone: userPhone,
                        answer: finalAnswer
                    });
                } else {
                    // No answer typed, lock it down
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Time is up!';
                    answerInput.disabled = true;

                    // Set submitted view for empty answer
                    submittedQuestionEl.textContent = liveQuestionEl.textContent;
                    if (liveQuestionImageEl.style.display === 'block') {
                        submittedQuestionImageEl.src = liveQuestionImageEl.src;
                        submittedQuestionImageEl.style.display = 'block';
                    } else {
                        submittedQuestionImageEl.style.display = 'none';
                        submittedQuestionImageEl.src = '';
                    }
                    submittedAnswerEl.textContent = "No answer provided (Time Out).";

                    // Auto switch to submitted after a short delay
                    setTimeout(() => {
                        switchView('submitted');
                    }, 3000);
                }
            }
        }
    };

    timerInterval = setInterval(updateTimer, 100);
    updateTimer(); // Call immediately
}

// Check for existing session right away
const savedName = localStorage.getItem('quiz_username');
const savedPhone = localStorage.getItem('quiz_userphone');
if (savedName && savedPhone) {
    userName = savedName;
    userPhone = savedPhone;
    displayName.textContent = `${userName} (${userPhone})`;
    studentHeader.style.display = 'flex';
    // The screen switch will be handled by socket.on('current_state') 
    // because userName is now populated.
} else {
    // Show the name section by default if no saved name
    switchView('name');
}

// Event Listeners (UI)
joinBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    const phone = userphoneInput.value.trim();
    
    if (name && phone) {
        userName = name;
        userPhone = phone;
        localStorage.setItem('quiz_username', userName); // Save for future refreshes
        localStorage.setItem('quiz_userphone', userPhone);
        displayName.textContent = `${userName} (${userPhone})`;
        studentHeader.style.display = 'flex';
        switchView('waiting');
        socket.emit('user_join_roster', { name: userName, phone: userPhone });
    } else {
        if (!name) {
            usernameInput.focus();
            usernameInput.style.borderColor = 'var(--error)';
            setTimeout(() => usernameInput.style.borderColor = '', 1500);
        } else {
            userphoneInput.focus();
            userphoneInput.style.borderColor = 'var(--error)';
            setTimeout(() => userphoneInput.style.borderColor = '', 1500);
        }
    }
});

usernameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') userphoneInput.focus();
});
userphoneInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') joinBtn.click();
});

submitBtn.addEventListener('click', () => {
    const answer = answerInput.value.trim();
    if (!answer) {
        answerInput.focus();
        return;
    }

    if (hasAnsweredCurrentQuestion) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    // Local UI update before server confirmation to avoid UI jumping
    submittedQuestionEl.textContent = liveQuestionEl.textContent;
    if (liveQuestionImageEl.style.display === 'block') {
        submittedQuestionImageEl.src = liveQuestionImageEl.src;
        submittedQuestionImageEl.style.display = 'block';
    } else {
        submittedQuestionImageEl.style.display = 'none';
        submittedQuestionImageEl.src = '';
    }
    submittedAnswerEl.textContent = answer;

    // Emit to server
    socket.emit('user_submit_answer', {
        name: userName,
        phone: userPhone,
        answer: answer
    });
});

answerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault(); // Prevent a new line being added
        submitBtn.click();
    }
});

// Event Listeners (Socket)
socket.on('current_state', (state) => {
    if (!userName || !userPhone) return; // User hasn't joined yet

    // Inform server of our name (useful if sever restarted but we are still here)
    socket.emit('user_join_roster', { name: userName, phone: userPhone });

    if (state.history) {
        renderHistory(state.history, userName);
    }

    if (state.triviaHints) {
        triviaHints = state.triviaHints;
    }

    if (state.activeQuestion) {
        const timeOffset = Date.now() - state.serverTime;
        const localEndTime = state.timerEnd + timeOffset;

        if (localEndTime > Date.now()) {
            hasAnsweredCurrentQuestion = false;
            startQuestion(state.activeQuestion, state.activeImage, state.timerEnd, state.serverTime);
            return;
        }
    }

    switchView('waiting');
});

socket.on('new_question', (data) => {
    if (!userName) return; // Haven't joined yet

    if (data.history) {
        renderHistory(data.history, userName);
    }

    hasAnsweredCurrentQuestion = false;
    startQuestion(data.question, data.image, data.timerEnd, data.serverTime);
});

socket.on('submission_success', () => {
    hasAnsweredCurrentQuestion = true;
    switchView('submitted');
});

socket.on('submission_error', (data) => {
    alert(data.message);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Answer';
});

socket.on('session_cleared', () => {
    if (userName) {
        waitingTitle.textContent = "Waiting...";
        waitingMessage.textContent = "Waiting for the host to ask a question.";
        historyList.innerHTML = '';
        studentScore.textContent = '0 / 0';
        switchView('waiting');
    }
});

socket.on('leaderboard_update', (data) => {
    if (!userName || !userPhone) return;
    const leaderboard = data.leaderboard || [];
    const totalQuestions = data.totalQuestions || 0;
    
    const myEntry = leaderboard.find(entry => entry.phone === userPhone);
    if (myEntry) {
        studentScore.textContent = `${myEntry.score} / ${totalQuestions}`;
    } else {
        studentScore.textContent = `0 / ${totalQuestions}`;
    }

    renderPodium(leaderboard);
});

socket.on('trivia_update', (hints) => {
    triviaHints = hints;
    if ((currentView === 'waiting' || currentView === 'submitted') && triviaHints.length > 0) {
        triviaPanel.style.display = 'block';
        startTriviaRotation();
    }
});

socket.on('show_hype', (emoji) => {
    showHype(emoji);
});

window.sendHype = function(emoji) {
    socket.emit('student_hype', emoji);
};

function showHype(emoji) {
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = emoji;
    
    // Random position
    const left = Math.random() * 80 + 10;
    el.style.left = `${left}%`;
    
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
}

function renderPodium(leaderboard) {
    if (!podiumContainer) return;
    
    // Take top 5 for better visibility on student side
    const topPerformers = leaderboard.slice(0, 5);
    if (topPerformers.length === 0) {
        podiumContainer.innerHTML = '<div class="empty-state">Waiting for results...</div>';
        return;
    }

    let html = '';
    
    topPerformers.forEach((player, index) => {
        const rank = index + 1;
        html += `
            <div class="podium-item rank-${rank}">
                <div class="podium-rank">#${rank}</div>
                <div class="podium-avatar">${getAvatarEmoji(player.phone || player.name)}</div>
                <div class="podium-name">${player.name}</div>
                <div class="podium-score">${player.score} <span style="font-size: 0.7rem; color: #64748b;">pts</span></div>
            </div>
        `;
    });

    podiumContainer.innerHTML = html;
}

function startTriviaRotation() {
    clearInterval(triviaInterval);
    if (triviaHints.length === 0) return;

    const showNext = () => {
        const hint = triviaHints[Math.floor(Math.random() * triviaHints.length)];
        triviaContent.style.opacity = 0;
        setTimeout(() => {
            triviaContent.textContent = hint;
            triviaContent.style.opacity = 1;
        }, 500);
    };

    showNext();
    triviaInterval = setInterval(showNext, 8000);
}

socket.on('response_marked', ({ responseId, isCorrect, phone }) => {
    if (userName && userPhone && phone === userPhone) {
        // Reaction logic
        if (isCorrect === true) {
            // Confetti for correct
            if (typeof confetti === 'function') {
                confetti({
                    particleCount: 150,
                    spread: 80,
                    origin: { y: 0.6 },
                    colors: ['#10b981', '#fcd34d', '#818cf8']
                });
            }
        } else if (isCorrect === false) {
            // Sad face toast for incorrect
            toastEmoji.textContent = '😞';
            toastMessage.textContent = 'Ah, incorrect this time!';
            toastReaction.classList.add('show');
            setTimeout(() => {
                toastReaction.classList.remove('show');
            }, 3000);
        }
    }
});

function startQuestion(question, image, timerEnd, serverTime) {
    liveQuestionEl.textContent = question;
    
    if (image) {
        liveQuestionImageEl.src = image;
        liveQuestionImageEl.style.display = 'block';
    } else {
        liveQuestionImageEl.style.display = 'none';
        liveQuestionImageEl.src = '';
    }

    answerInput.value = '';
    answerInput.disabled = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Answer';

    startTimer(timerEnd, serverTime);
    switchView('question');
    answerInput.focus();
}

function renderHistory(historyData, currentUserName) {
    historyList.innerHTML = '';

    if (!historyData || historyData.length === 0) {
        historyList.innerHTML = '<div style="color: #64748b; font-size: 0.9rem; font-style: italic;">No previous questions found for this session.</div>';
        return;
    }

    // Reverse to show newest history items first
    const reversedHistory = [...historyData].reverse();

    let html = '<div style="display: flex; flex-direction: column; gap: 1rem;">';

    reversedHistory.forEach((session, idx) => {
        const entry = session.responses.find(r => r.name === currentUserName);
        const qNumDate = historyData.length - idx;
        
        let statusText = "No answer";
        let style = "color: #64748b;";
        
        if (entry) {
            if (entry.isCorrect === true) {
                statusText = "Correct";
                style = "color: #10b981;";
            } else if (entry.isCorrect === false) {
                statusText = "Incorrect";
                style = "color: #ef4444;";
            } else {
                statusText = "Pending";
                style = "color: #f59e0b;";
            }
        }

        html += `
            <div style="background: rgba(255, 255, 255, 0.05); padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--glass-border);">
                <div style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.5rem; display: flex; justify-content: space-between;">
                    <span>Q${qNumDate}</span>
                    <span style="${style}">${statusText}</span>
                </div>
                <div class="question-text" id="submitted-question"
                    style="font-size: 1rem; color: #94a3b8; margin-bottom: 1rem; background-clip: initial; -webkit-background-clip: initial;">
                    ${escapeHTML(session.question)}
                </div>
                <div style="font-size: 0.9rem; color: #818cf8; font-weight: 500;"><span class="leaderboard-avatar">${getAvatarEmoji(userPhone || userName)}</span> Your Ans: ${entry ? escapeHTML(entry.answer) : 'N/A'}</div>
            </div>
        `;
    });

    html += '</div>';
    historyList.innerHTML = html;
}

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

// Ping interval to keep server alive
setInterval(() => {
    fetch('/api/ping').catch(() => {});
}, 5 * 60 * 1000);

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
    waiting: document.getElementById('waiting-section'),
    question: document.getElementById('question-section'),
    submitted: document.getElementById('submitted-section')
};

const joinBtn = document.getElementById('join-btn');
const usernameInput = document.getElementById('username');
const userphoneInput = document.getElementById('userphone');
const submitBtn = document.getElementById('submit-btn');
const answerInput = document.getElementById('answer-input');
const liveQuestionEl = document.getElementById('live-question');
const countdownEl = document.getElementById('countdown');
const liveQuestionImageEl = document.getElementById('live-question-image');
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

// Utility Functions
function switchView(viewName) {
    Object.values(sections).forEach(section => section.classList.remove('active'));
    sections[viewName].classList.add('active');
    currentView = viewName;

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

    const updateTimer = () => {
        const now = Date.now();
        const remaining = Math.max(0, endTime - now);
        const seconds = Math.floor(remaining / 1000);

        countdownEl.textContent = seconds;

        if (seconds <= 10) {
            countdownEl.classList.add('warning');
        } else {
            countdownEl.classList.remove('warning');
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
    sections['name'].classList.add('active');
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
});

socket.on('response_marked', ({ responseId, isCorrect, phone }) => {
    if (userName && userPhone && phone === userPhone) {
        // Did we just get marked as Correct?
        if (isCorrect === true) {
            if (typeof confetti === 'function') {
                confetti({
                    particleCount: 150,
                    spread: 80,
                    origin: { y: 0.6 },
                    colors: ['#10b981', '#fcd34d', '#indigo']
                });
            }
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

    // Build table structure
    let tableHtml = `
        <table class="data-table">
            <thead>
                <tr>
                    <th style="width: 10%;">#</th>
                    <th style="width: 50%;">Question</th>
                    <th style="width: 40%;">Your Answer</th>
                </tr>
            </thead>
            <tbody>
    `;

    // Reverse to show newest history items first
    const reversedHistory = [...historyData].reverse();

    reversedHistory.forEach((session, idx) => {
        // Find if the current user answered this question
        const userResponse = session.responses.find(r => r.name === currentUserName);
        const answerText = userResponse ? userResponse.answer : "Did not answer";
        const answerColor = userResponse ? "#f8fafc" : "#64748b";
        const questionNumber = historyData.length - idx;
        const questionHtml = escapeHTML(session.question);
        const imageHtml = session.image ? `<br><img src="${session.image}" style="max-height: 100px; max-width: 100%; border-radius: 0.5rem; margin-top: 0.5rem; border: 1px solid rgba(255,255,255,0.1);">` : '';

        tableHtml += `
            <tr>
                <td style="color: #818cf8; font-weight: 500;">Q${questionNumber}</td>
                <td>${questionHtml}${imageHtml}</td>
                <td style="color: ${answerColor}; white-space: pre-wrap;">${escapeHTML(answerText)}</td>
            </tr>
        `;
    });

    tableHtml += `
            </tbody>
        </table>
    `;

    historyList.innerHTML = tableHtml;
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

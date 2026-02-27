const socket = io();

// State
let userName = '';
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
const submitBtn = document.getElementById('submit-btn');
const answerInput = document.getElementById('answer-input');
const liveQuestionEl = document.getElementById('live-question');
const countdownEl = document.getElementById('countdown');
const waitingTitle = document.getElementById('waiting-title');
const waitingMessage = document.getElementById('waiting-message');
const submittedQuestionEl = document.getElementById('submitted-question');
const submittedAnswerEl = document.getElementById('submitted-answer');
const historyPanel = document.getElementById('history-panel');
const historyList = document.getElementById('history-list');

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
                    submittedAnswerEl.textContent = finalAnswer;

                    socket.emit('user_submit_answer', {
                        name: userName,
                        answer: finalAnswer
                    });
                } else {
                    // No answer typed, lock it down
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Time is up!';
                    answerInput.disabled = true;

                    // Set submitted view for empty answer
                    submittedQuestionEl.textContent = liveQuestionEl.textContent;
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

// Event Listeners (UI)
joinBtn.addEventListener('click', () => {
    const name = usernameInput.value.trim();
    if (name) {
        userName = name;
        switchView('waiting');
        socket.emit('user_join_roster', userName);
    } else {
        usernameInput.focus();
        usernameInput.style.borderColor = 'var(--error)';
        setTimeout(() => usernameInput.style.borderColor = '', 1500);
    }
});

usernameInput.addEventListener('keypress', (e) => {
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
    submittedAnswerEl.textContent = answer;

    // Emit to server
    socket.emit('user_submit_answer', {
        name: userName,
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
    if (!userName) return; // User hasn't joined yet

    // Inform server of our name (useful if sever restarted but we are still here)
    socket.emit('user_join_roster', userName);

    if (state.history) {
        renderHistory(state.history, userName);
    }

    if (state.activeQuestion) {
        const timeOffset = Date.now() - state.serverTime;
        const localEndTime = state.timerEnd + timeOffset;

        if (localEndTime > Date.now()) {
            hasAnsweredCurrentQuestion = false;
            startQuestion(state.activeQuestion, state.timerEnd, state.serverTime);
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
    startQuestion(data.question, data.timerEnd, data.serverTime);
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
        switchView('waiting');
    }
});

function startQuestion(question, timerEnd, serverTime) {
    liveQuestionEl.textContent = question;
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

        tableHtml += `
            <tr>
                <td style="color: #818cf8; font-weight: 500;">Q${questionNumber}</td>
                <td>${escapeHTML(session.question)}</td>
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

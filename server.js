const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const xlsx = require('xlsx');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Persistent Data Storage
const DATA_FILE = path.join(__dirname, 'data.json');

// Application State
let activeQuestion = null;
let timerEnd = null; // Timestamp when the question expires
let responses = []; // Array of { name: string, answer: string, id: string }
let history = []; // Array to store all past questions and responses

// Load history from disk on startup
try {
    if (fs.existsSync(DATA_FILE)) {
        const rawData = fs.readFileSync(DATA_FILE, 'utf8');
        history = JSON.parse(rawData);
        console.log(`Loaded ${history.length} historical sessions from data.json`);
    } else {
        // Create an empty file if it doesn't exist
        fs.writeFileSync(DATA_FILE, JSON.stringify([]));
    }
} catch (error) {
    console.error("Error loading data.json:", error);
    history = [];
}

// Helper function to save history
function saveHistory() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(history, null, 2));
    } catch (error) {
        console.error("Error saving to data.json:", error);
    }
}
let connectedUsers = new Map(); // Map to store socket.id -> name

const ADMIN_PASSWORD = 'Prasath_04';

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Broadcast total count, though we will also send names now
    io.emit('client_count', io.engine.clientsCount);

    socket.on('user_join_roster', (name) => {
        connectedUsers.set(socket.id, name);
        // Only admins need the roster
        io.emit('roster_update', Array.from(connectedUsers.values()));
    });

    // When a user connects, send them the current state
    socket.emit('current_state', {
        activeQuestion,
        timerEnd,
        serverTime: Date.now(),
        history // Send full history on join
    });

    // Send admin current responses if they just joined
    socket.on('admin_join', (password) => {
        if (password !== ADMIN_PASSWORD) return;

        socket.emit('admin_init', {
            activeQuestion,
            timerEnd,
            serverTime: Date.now(),
            responses
        });
        socket.emit('roster_update', Array.from(connectedUsers.values()));
    });

    // Admin starts a new question
    socket.on('admin_start_question', ({ question, duration, password }) => {
        if (password !== ADMIN_PASSWORD) return;

        // Archive the previous active question before starting a new one
        if (activeQuestion) {
            history.push({
                question: activeQuestion,
                responses: [...responses],
                timestamp: new Date().toISOString()
            });
            saveHistory(); // Persist to disk
        }

        const durationMs = (duration || 60) * 1000;

        console.log(`New question asked: ${question} for ${duration}s`);
        activeQuestion = question;
        timerEnd = Date.now() + durationMs;
        responses = []; // Reset responses for the new question

        // Broadcast the new question to all connected clients
        io.emit('new_question', {
            question,
            timerEnd,
            serverTime: Date.now(),
            history // Send updated history
        });
    });

    // User submits an answer
    socket.on('user_submit_answer', ({ name, answer }) => {
        // Validate if question is active and time hasn't expired
        if (!activeQuestion) {
            socket.emit('submission_error', { message: 'No active question.' });
            return;
        }

        // Allow a 5-second grace period for auto-submitted answers from the client
        // to account for client interval timing and network latency
        if (Date.now() > timerEnd + 5000) {
            socket.emit('submission_error', { message: 'Time is up!' });
            return;
        }

        // Guarantee the user is in the roster (fallback for stale clients)
        if (!connectedUsers.has(socket.id)) {
            connectedUsers.set(socket.id, name);
            io.emit('roster_update', Array.from(connectedUsers.values()));
        }

        // Add response
        const newResponse = {
            name,
            answer,
            id: socket.id,
            responseId: `resp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            isCorrect: null // null = unmarked, true = correct, false = incorrect
        };
        responses.push(newResponse);

        console.log(`Answer received from ${name}: ${answer}`);

        // Acknowledge submission to the user
        socket.emit('submission_success');

        // Broadcast the new response to the admin only
        io.emit('new_response', newResponse);
    });

    // Admin marks a response as correct/incorrect
    socket.on('admin_mark_response', ({ responseId, isCorrect, password }) => {
        if (password !== ADMIN_PASSWORD) return;

        // Check current responses
        let found = false;
        const resp = responses.find(r => r.responseId === responseId);
        if (resp) {
            resp.isCorrect = isCorrect;
            found = true;
        } else {
            // Check history
            for (let session of history) {
                const hResp = session.responses.find(r => r.responseId === responseId);
                if (hResp) {
                    hResp.isCorrect = isCorrect;
                    found = true;
                    saveHistory();
                    break;
                }
            }
        }

        if (found) {
            io.emit('response_marked', { responseId, isCorrect });
            // Broadcast leaderboard update
            io.emit('leaderboard_update', calculateLeaderboard());
        }
    });

    function calculateLeaderboard() {
        const scores = new Map();

        const processResponses = (resps) => {
            resps.forEach(r => {
                if (r.isCorrect === true) {
                    scores.set(r.name, (scores.get(r.name) || 0) + 1);
                }
            });
        };

        // Process history
        history.forEach(session => processResponses(session.responses));
        // Process current
        processResponses(responses);

        // Convert to array and sort
        return Array.from(scores.entries())
            .map(([name, score]) => ({ name, score }))
            .sort((a, b) => b.score - a.score);
    }

    // Admin requests leaderboard
    socket.on('admin_get_leaderboard', (password) => {
        if (password !== ADMIN_PASSWORD) return;
        socket.emit('leaderboard_update', calculateLeaderboard());
    });

    // Admin clears the current session
    socket.on('admin_clear', (password) => {
        if (password !== ADMIN_PASSWORD) return;

        activeQuestion = null;
        timerEnd = null;
        responses = [];
        io.emit('session_cleared');
    });

    // Admin permanently deletes all history
    socket.on('admin_delete_all_records', (password) => {
        if (password !== ADMIN_PASSWORD) return;

        history = [];
        saveHistory(); // Clear the disk file

        // Also clear the active question/responses since they asked to wipe everything
        activeQuestion = null;
        timerEnd = null;
        responses = [];

        io.emit('session_cleared');
        // Sending an empty history forces admin UI to clear the table
        socket.emit('admin_init', {
            activeQuestion: null,
            timerEnd: null,
            serverTime: Date.now(),
            responses: [],
            history: []
        });
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        connectedUsers.delete(socket.id);

        io.emit('client_count', io.engine.clientsCount);
        io.emit('roster_update', Array.from(connectedUsers.values()));
    });
});

// API endpoint for Excel Export
app.get('/api/export', (req, res) => {
    try {
        // Prepare the dataset for the current active question if there is one
        const currentData = activeQuestion ? [{
            question: activeQuestion,
            responses: [...responses],
            timestamp: new Date().toISOString()
        }] : [];

        // Combine history and current data
        let allData = [...history, ...currentData];

        // Apply Date Filtering
        const { start, end } = req.query;
        if (start || end) {
            allData = allData.filter(session => {
                const sessionDate = new Date(session.timestamp);

                if (start) {
                    const startDate = new Date(start);
                    // Start of the provided day
                    startDate.setHours(0, 0, 0, 0);
                    if (sessionDate < startDate) return false;
                }

                if (end) {
                    const endDate = new Date(end);
                    // End of the provided day
                    endDate.setHours(23, 59, 59, 999);
                    if (sessionDate > endDate) return false;
                }

                return true;
            });
        }

        if (allData.length === 0) {
            return res.status(400).send("No data to export for the given date range.");
        }

        // Format data into a flat structure for the Excel sheet
        const excelRows = [];
        allData.forEach((session, idx) => {
            if (session.responses.length === 0) {
                excelRows.push({
                    Session: idx + 1,
                    Timestamp: session.timestamp,
                    Question: session.question,
                    Student_Name: 'N/A (No responses)',
                    Answer: 'N/A'
                });
            } else {
                session.responses.forEach(resp => {
                    excelRows.push({
                        Session: idx + 1,
                        Timestamp: session.timestamp,
                        Question: session.question,
                        Student_Name: resp.name,
                        Answer: resp.answer
                    });
                });
            }
        });

        // Create workbook and worksheet
        const workbook = xlsx.utils.book_new();
        const worksheet = xlsx.utils.json_to_sheet(excelRows);

        // Append worksheet to workbook
        xlsx.utils.book_append_sheet(workbook, worksheet, "Quiz Responses");

        // Write to buffer
        const buffer = xlsx.write(workbook, { bookType: 'xlsx', type: 'buffer' });

        // Set headers to trigger file download
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="quiz_responses_${Date.now()}.xlsx"`);

        // Send the file
        res.send(buffer);
    } catch (error) {
        console.error("Export error:", error);
        res.status(500).send("An error occurred during export.");
    }
});

const PORT = 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on all network interfaces `);
    console.log(`Access locally: http://localhost:${PORT}`);
    console.log(`Access on network: Use the host machine's local IP.`);
});

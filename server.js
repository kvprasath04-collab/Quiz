const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const xlsx = require('xlsx');
const fs = require('fs');
const mongoose = require('mongoose');
const multer = require('multer');
const pdfParse = require('pdf-parse');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Increase limits for processing large PDF files (32MB+ )
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Configure Express to handle large headers/payloads
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// Persistent Data Storage (Supports Render Disks via DATA_DIR environment variable)
const dataDir = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(dataDir, 'data.json');
const STATE_FILE = path.join(dataDir, 'state.json');

const MONGODB_URI = process.env.MONGODB_URI || null;
const SessionHistory = mongoose.model('SessionHistory', new mongoose.Schema({}, { strict: false }));
const SystemState = mongoose.model('SystemState', new mongoose.Schema({}, { strict: false }));

// Application State
let activeQuestion = null;
let activeImage = null;
let timerEnd = null; // Timestamp when the question expires
let responses = []; // Array of { name: string, answer: string, id: string }
let history = []; // Array to store all past questions and responses
let sessionStartTime = Date.now(); // Timestamp to start calculating scores from
let triviaHints = []; // Array of hints extracted from PDF

// Load history and state from disk or Mongo on startup
async function initState() {
    if (MONGODB_URI) {
        try {
            await mongoose.connect(MONGODB_URI);
            console.log("Connected to MongoDB Cloud Database!");
            
            // Load History
            const dbHistory = await SessionHistory.find({}).sort({ timestamp: 1 });
            history = dbHistory.map(doc => doc.toObject());
            console.log(`Loaded ${history.length} historical sessions from MongoDB`);

            // Load State
            const stateDoc = await SystemState.findOne({});
            if (stateDoc) {
                const s = stateDoc.toObject();
                activeQuestion = s.activeQuestion || null;
                activeImage = s.activeImage || null;
                timerEnd = s.timerEnd || null;
                responses = s.responses || [];
                sessionStartTime = s.sessionStartTime || Date.now();
                triviaHints = s.triviaHints || [];
            }
        } catch (error) {
            console.error("Error connecting to MongoDB:", error);
            history = [];
        }
    } else {
        try {
            if (fs.existsSync(DATA_FILE)) {
                const rawData = fs.readFileSync(DATA_FILE, 'utf8');
                history = JSON.parse(rawData);
                console.log(`Loaded ${history.length} historical sessions from data.json`);
            } else {
                fs.writeFileSync(DATA_FILE, JSON.stringify([]));
            }
            
            if (fs.existsSync(STATE_FILE)) {
                const stateData = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
                activeQuestion = stateData.activeQuestion || null;
                activeImage = stateData.activeImage || null;
                timerEnd = stateData.timerEnd || null;
                responses = stateData.responses || [];
                sessionStartTime = stateData.sessionStartTime || Date.now();
                triviaHints = stateData.triviaHints || [];
            }
        } catch (error) {
            console.error("Error loading local files:", error);
            history = [];
        }
    }

    // Auto-reset logic if the day has changed
    const savedDate = new Date(sessionStartTime).toDateString();
    const todayDate = new Date().toDateString();
    if (savedDate !== todayDate) {
        console.log("New day detected cross-session. Automatically restarting session.");
        sessionStartTime = Date.now();
        activeQuestion = null;
        activeImage = null;
        timerEnd = null;
        responses = [];
        saveState();
    }
}
initState();

// Helper function to save history and current state
async function saveState() {
    const currentStateObj = {
        activeQuestion,
        activeImage,
        timerEnd,
        responses,
        sessionStartTime,
        triviaHints
    };

    if (MONGODB_URI) {
        try {
            // History
            await SessionHistory.deleteMany({});
            if (history.length > 0) {
                await SessionHistory.insertMany(history);
            }
            // State
            await SystemState.deleteMany({});
            await SystemState.create(currentStateObj);
        } catch (error) {
            console.error("Error saving to MongoDB:", error);
        }
    } else {
        try {
            fs.writeFile(DATA_FILE, JSON.stringify(history, null, 2), err => {
                if (err) console.error("Error saving strictly local data:", err);
            });
            fs.writeFile(STATE_FILE, JSON.stringify(currentStateObj, null, 2), err => {
                if (err) console.error("Error saving strictly local state:", err);
            });
        } catch (error) {
            console.error("Error initiating local save:", error);
        }
    }
}
let connectedUsers = new Map(); // Map to store socket.id -> name

const ADMIN_PASSWORD = 'Prasath_04';

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Broadcast that a new socket connected.
    // The metric 'client_count' now Tracks only registered students
    io.emit('client_count', connectedUsers.size);

    socket.on('user_join_roster', (data) => {
        let displayName = data;
        if (data && typeof data === 'object') {
            displayName = data.phone ? `${data.name} (${data.phone})` : data.name;
        }
        connectedUsers.set(socket.id, displayName);
        // Only admins need the roster
        io.emit('roster_update', Array.from(connectedUsers.values()));
        io.emit('client_count', connectedUsers.size);
    });

    // Helper to get only today's session history for the client UI
    function getSessionHistory() {
        return history.filter(session => new Date(session.timestamp).getTime() >= sessionStartTime);
    }

    // When a user connects, send them the current state
    socket.emit('current_state', {
        activeQuestion,
        activeImage,
        timerEnd,
        serverTime: Date.now(),
        triviaHints,
        history: getSessionHistory() // Send only current session history on join
    });
    // Send the current leaderboard so returning students can see their score
    socket.emit('leaderboard_update', calculateLeaderboard());

    // Send admin current responses if they just joined
    socket.on('admin_join', (password) => {
        if (password !== ADMIN_PASSWORD) return;

        socket.emit('admin_init', {
            activeQuestion,
            activeImage,
            timerEnd,
            serverTime: Date.now(),
            responses,
            triviaHints,
            history: getSessionHistory()
        });
        socket.emit('roster_update', Array.from(connectedUsers.values()));
    });

    // Admin starts a new question
    socket.on('admin_start_question', ({ question, image, duration, password }) => {
        if (password !== ADMIN_PASSWORD) return;

        // Archive the previous active question before starting a new one
        if (activeQuestion) {
            history.push({
                question: activeQuestion,
                image: activeImage,
                responses: [...responses],
                timestamp: new Date().toISOString()
            });
        }

        const durationMs = (duration || 60) * 1000;

        console.log(`New question asked: ${question} for ${duration}s (Has Image: ${!!image})`);
        activeQuestion = question;
        activeImage = image;
        timerEnd = Date.now() + durationMs;
        responses = []; // Reset responses for the new question
        saveState(); // Persist active question to disk

        // Broadcast the new question to all connected clients
        io.emit('new_question', {
            question,
            image: activeImage,
            timerEnd,
            serverTime: Date.now(),
            history: getSessionHistory() // Send only current session history
        });
    });

    // User submits an answer
    socket.on('user_submit_answer', ({ name, phone, answer }) => {
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

        // Prevent duplicate answers by the same user to avoid duplicate score accumulation
        if (responses.some(r => (phone && r.phone === phone) || (!phone && r.name === name))) {
            socket.emit('submission_error', { message: 'You have already submitted an answer for this question.' });
            return;
        }

        // Guarantee the user is in the roster (fallback for stale clients)
        if (!connectedUsers.has(socket.id)) {
            connectedUsers.set(socket.id, phone ? `${name} (${phone})` : name);
            io.emit('roster_update', Array.from(connectedUsers.values()));
            io.emit('client_count', connectedUsers.size);
        }

        // Add response
        const newResponse = {
            name,
            phone,
            answer,
            id: socket.id,
            responseId: `resp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            isCorrect: null // null = unmarked, true = correct, false = incorrect
        };
        responses.push(newResponse);
        saveState();

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
        let foundResp = null;
        const resp = responses.find(r => r.responseId === responseId);
        if (resp) {
            resp.isCorrect = isCorrect;
            foundResp = resp;
            saveState();
        } else {
            // Check history
            for (let session of history) {
                const hResp = session.responses.find(r => r.responseId === responseId);
                if (hResp) {
                    hResp.isCorrect = isCorrect;
                    foundResp = hResp;
                    saveState();
                    break;
                }
            }
        }

        if (foundResp) {
            io.emit('response_marked', { responseId, isCorrect, phone: foundResp.phone });
            // Broadcast leaderboard update
            io.emit('leaderboard_update', calculateLeaderboard());
        }
    });

    function calculateLeaderboard() {
        const scores = new Map();
        let totalQuestions = 0;

        const processResponses = (resps) => {
            resps.forEach(r => {
                if (r.isCorrect === true) {
                    const phoneKey = r.phone || r.name; // Fallback to name if phone is missing
                    const existing = scores.get(phoneKey) || { name: r.name, phone: phoneKey, score: 0 };
                    existing.score += 1;
                    if (r.name) existing.name = r.name; // Use latest name
                    scores.set(phoneKey, existing);
                }
            });
        };

        // Process only history items that occurred after sessionStartTime
        history.forEach(session => {
            if (new Date(session.timestamp).getTime() >= sessionStartTime) {
                totalQuestions++;
                processResponses(session.responses);
            }
        });
        
        // Process current active responses
        if (activeQuestion) {
            totalQuestions++;
            processResponses(responses);
        }

        // Convert to array and sort
        const leaderboardData = Array.from(scores.values())
            .map(entry => ({ name: entry.name, phone: entry.phone, score: entry.score }))
            .sort((a, b) => b.score - a.score);

        return {
            leaderboard: leaderboardData,
            totalQuestions: totalQuestions
        };
    }

    // Admin requests leaderboard
    socket.on('admin_get_leaderboard', (password) => {
        if (password !== ADMIN_PASSWORD) return;
        socket.emit('leaderboard_update', calculateLeaderboard());
    });

    // Admin clears the current session
    socket.on('admin_clear', (password) => {
        if (password !== ADMIN_PASSWORD) return;

        // Archive the question first if it exists
        if (activeQuestion) {
            history.push({
                question: activeQuestion,
                image: activeImage,
                responses: [...responses],
                timestamp: new Date().toISOString()
            });
        }

        activeQuestion = null;
        activeImage = null;
        timerEnd = null;
        responses = [];
        saveState(); // Save state including archived question and cleared active variables
        
        io.emit('session_cleared');
        io.emit('leaderboard_update', calculateLeaderboard()); // Broadcast that the leaderboard is still there but question cleared
    });

    // Admin restarts the entire session for the day
    socket.on('admin_restart_session', (password) => {
        if (password !== ADMIN_PASSWORD) return;

        // Archive the question first if it exists
        if (activeQuestion) {
            history.push({
                question: activeQuestion,
                image: activeImage,
                responses: [...responses],
                timestamp: new Date().toISOString()
            });
        }

        activeQuestion = null;
        activeImage = null;
        timerEnd = null;
        responses = [];
        
        // Reset scores start time
        sessionStartTime = Date.now();
        saveState();
        
        io.emit('session_cleared');
        io.emit('leaderboard_update', calculateLeaderboard()); // Broadcast that the leaderboard is now empty
    });

    // Admin permanently deletes all history
    socket.on('admin_delete_all_records', (password) => {
        if (password !== ADMIN_PASSWORD) return;

        history = [];

        // Also clear the active question/responses since they asked to wipe everything
        activeQuestion = null;
        activeImage = null;
        timerEnd = null;
        responses = [];
        sessionStartTime = Date.now();
        saveState(); // Clear the disk file and state

        io.emit('session_cleared');
        // Sending an empty history forces admin UI to clear the table
        socket.emit('admin_init', {
            activeQuestion: null,
            activeImage: null,
            timerEnd: null,
            serverTime: Date.now(),
            responses: [],
            history: []
        });
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        connectedUsers.delete(socket.id);

        io.emit('client_count', connectedUsers.size);
        io.emit('roster_update', Array.from(connectedUsers.values()));
    });
    
    // Broadcast hype emojis to admin and specific room/clients
    socket.on('student_hype', (emoji) => {
        io.emit('show_hype', emoji);
    });
});

// PDF Parsing Route for extracting trivia
app.post('/api/upload-pdf', upload.single('pdf'), async (req, res) => {
    if (!req.file || req.body.password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized or missing file' });
    }
    try {
        const fromPage = parseInt(req.body.fromPage) || 1;
        const toPage = parseInt(req.body.toPage) || 9999;

        console.log(`Extraction Request: From Page ${fromPage} to ${toPage}`);
        
        let extracted = [];
        let options = {
            pagerender: function(pageData) {
                const currentPage = pageData.pageIndex + 1;
                
                // Stop rendering if we already have enough trivia (e.g. 50 facts)
                if (extracted.length >= 50) {
                    return Promise.resolve("");
                }

                if (currentPage >= fromPage && currentPage <= toPage) {
                    console.log(`[Trivia Engine] Extracting Text from Page ${currentPage}...`);
                    return pageData.getTextContent().then(function(textContent) {
                        let lastY, lastX, text = '';
                        for (let item of textContent.items) {
                            if (lastY == item.transform[5] || !lastY){
                                if (lastX && (item.transform[4] - lastX) > 2) {
                                    text += ' ' + item.str;
                                } else {
                                    text += item.str;
                                }
                            } else {
                                text += '\n' + item.str;
                            }    
                            lastY = item.transform[5];
                            lastX = item.transform[4] + (item.width || 0);
                        }
                        
                        // Process this page's text immediately to see if we hit the limit
                        const cleanText = text.replace(/\s+/g, ' ').trim();
                        const sentences = cleanText.split(/(?<=[.!?])\s+/);
                        
                        for(let s of sentences) {
                            if (extracted.length >= 50) break;
                            let clean = s.replace(/[\n\r]/g, ' ').trim();
                            // Filter for quality trivia sentences
                            if (clean.length > 30 && clean.length < 150) {
                                extracted.push(clean);
                            }
                        }
                        
                        return ""; // Returning empty string to keep memory usage low as we already stored facts in 'extracted'
                    });
                }
                return Promise.resolve("");
            }
        };

        await pdfParse(req.file.buffer, options);
        
        if (extracted.length === 0) {
            throw new Error('Could not find any suitable trivia sentences in this PDF.');
        }

        // Shuffle the extracted trivia
        extracted = extracted.sort(() => 0.5 - Math.random());
        
        triviaHints = extracted;
        saveState();
        
        io.emit('trivia_update', triviaHints);
        console.log(`Successfully extracted ${triviaHints.length} facts from PDF.`);
        res.json({ message: `Successfully extracted ${triviaHints.length} facts.`, count: triviaHints.length });
    } catch(err) {
        console.error("PDF Processing Error:", err.message);
        res.status(500).json({ error: `Failed to process PDF: ${err.message}` });
    }
});

// Ping endpoint to keep server alive (prevent PaaS idle sleep)
app.get('/api/ping', (req, res) => {
    res.status(200).send('pong');
});

// API endpoint for Excel Export
app.get('/api/export', (req, res) => {
    try {
        // Prepare the dataset for the current active question if there is one
        const currentData = activeQuestion ? [{
            question: activeQuestion,
            image: activeImage,
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
                    Phone_Number: 'N/A',
                    Answer: 'N/A'
                });
            } else {
                session.responses.forEach(resp => {
                    excelRows.push({
                        Session: idx + 1,
                        Timestamp: session.timestamp,
                        Question: session.question,
                        Student_Name: resp.name,
                        Phone_Number: resp.phone || 'N/A',
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

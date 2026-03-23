const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
let questions = require('./questions');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// In-memory state
let config = { duration: 60, posMark: 4, negMark: 1 };
let authorizedTeams = {}; // { '1234': { name: '...', rollNo: '...' } }

const state = {
  isExamStarted: false,
  examDuration: config.duration * 60, // in seconds
  examStartTime: null,
  students: {}, // { rollNo: { socketId, name, rollNo, connected, answers: { qId: { option, status } }, score } }
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123'
};

// Flatten questions for easy lookup & scoring
let allQuestions = {};
let totalPointsAvailable = 0;

function buildQuestionsMap() {
  allQuestions = {};
  totalPointsAvailable = 0;
  for (const section in questions) {
    questions[section].forEach(q => {
      allQuestions[q.id] = q;
      totalPointsAvailable += config.posMark;
    });
  }
}
buildQuestionsMap();

function calculateScore(answers) {
  let score = 0;
  for (const qId in answers) {
    const ans = answers[qId];
    if (ans.status === 'answered' || ans.status === 'marked_answered') {
      const actualQuestion = allQuestions[qId];
      if (actualQuestion && actualQuestion.answer === ans.option) {
        score += config.posMark;
      } else {
        score -= config.negMark; // Negative marking
      }
    }
  }
  return score;
}

// API endpoint to get questions without answers
app.get('/api/questions', (req, res) => {
  const sentQuestions = {};
  for (const section in questions) {
    sentQuestions[section] = questions[section].map(q => ({
      id: q.id,
      type: q.type,
      text: q.text,
      options: q.options
    }));
  }
  res.json({ questions: sentQuestions, config });
});

// Student Login Auth
app.post('/api/login', (req, res) => {
  const { name, rollNo } = req.body;
  if (!name || !rollNo) return res.status(400).json({ error: "Missing fields" });
  if (authorizedTeams[rollNo] && authorizedTeams[rollNo].name.toLowerCase() === name.toLowerCase()) {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: "Unauthorized. Please ensure Name and Roll No exactly match what the host provided." });
  }
});

// Admin Auth Login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === state.adminPassword) {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: "Invalid password" });
  }
});

// Middleware for admin routes (optional, but good for cleanliness)
const adminAuth = (req, res, next) => {
  // Simple check via header for now, or just let the specific routes handle it if staying simple
  // For this project, we'll keep it simple and just have the login endpoint for the UI to toggle
  next();
};

// Admin endpoints
app.get('/api/admin/config', (req, res) => {
  res.json({ config, questions, authorizedTeams });
});

app.post('/api/admin/config', (req, res) => {
  if (state.isExamStarted) return res.status(400).json({ error: "Cannot change config while exam is running" });
  
  const { newConfig, newQuestions } = req.body;
  if (newConfig) {
    config.duration = parseInt(newConfig.duration);
    config.posMark = parseInt(newConfig.posMark);
    config.negMark = parseInt(newConfig.negMark);
    state.examDuration = config.duration * 60;
  }
  if (newQuestions) {
    questions = newQuestions;
    buildQuestionsMap();
  }
  // Recalculate all scores based on new marking scheme
  Object.values(state.students).forEach(student => {
    student.score = calculateScore(student.answers);
  });
  io.emit('admin_update', Object.values(state.students));
  res.json({ success: true, config, questions });
});

app.post('/api/admin/add-question', (req, res) => {
  if (state.isExamStarted) return res.status(400).json({ error: "Cannot add while exam is running" });
  const { section, text, options, answer } = req.body;
  if (!questions[section]) questions[section] = [];
  const id = section.charAt(0).toLowerCase() + (questions[section].length + 1) + Date.now();
  questions[section].push({ id, type: 'mcq', text, options, answer: parseInt(answer) });
  buildQuestionsMap();
  res.json({ success: true, questions });
});

app.post('/api/admin/delete-question', (req, res) => {
  if (state.isExamStarted) return res.status(400).json({ error: "Cannot delete while exam is running" });
  const { section, id } = req.body;
  if (questions[section]) {
    questions[section] = questions[section].filter(q => q.id !== id);
    buildQuestionsMap();
  }
  res.json({ success: true, questions });
});

app.post('/api/admin/bulk-add-questions', (req, res) => {
  if (state.isExamStarted) return res.status(400).json({ error: "Cannot add while exam is running" });
  const { newQuestions } = req.body;
  if (!newQuestions || typeof newQuestions !== 'object') return res.status(400).json({ error: "Invalid data format" });

  for (const section in newQuestions) {
    if (!questions[section]) questions[section] = [];
    newQuestions[section].forEach(q => {
      if (!q.id) q.id = section.charAt(0).toLowerCase() + (questions[section].length + 1) + Date.now();
      if (!q.type) q.type = 'mcq';
      questions[section].push(q);
    });
  }
  buildQuestionsMap();
  res.json({ success: true, questions });
});

// Admin Team Endpoints
app.post('/api/admin/add-team', (req, res) => {
  const { name, rollNo } = req.body;
  if(!name || !rollNo) return res.status(400).json({ error: "Missing fields" });
  authorizedTeams[rollNo] = { name, rollNo };
  res.json({ success: true, authorizedTeams });
});

app.post('/api/admin/delete-team', (req, res) => {
  const { rollNo } = req.body;
  if (authorizedTeams[rollNo]) {
    delete authorizedTeams[rollNo];
    // Also disconnect student if active? (Optional)
  }
  res.json({ success: true, authorizedTeams });
});

// Admin toggle exam status
app.post('/api/admin/toggle-exam', (req, res) => {
  state.isExamStarted = !state.isExamStarted;
  if (state.isExamStarted) {
    state.examStartTime = Date.now();
    io.emit('exam_started', { duration: state.examDuration });
  } else {
    state.examStartTime = null;
    io.emit('exam_ended');
  }
  res.json({ started: state.isExamStarted });
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Student joining
  socket.on('join_exam', ({ name, rollNo }, callback) => {
    if (!authorizedTeams[rollNo] || authorizedTeams[rollNo].name.toLowerCase() !== name.toLowerCase()) {
      return callback({ success: false, error: "Unauthorized" });
    }

    let student = Object.values(state.students).find(s => s.rollNo === rollNo);

    if (!student) {
      student = {
        name,
        rollNo,
        socketId: socket.id,
        connected: true,
        answers: {}, // { 'p1': { option: 2, status: 'answered' } } // status: not_visited, not_answered, answered, marked, marked_answered
        score: 0
      };
      state.students[rollNo] = student;
    } else {
      // Reconnect logic
      student.socketId = socket.id;
      student.connected = true;
      student.name = name; // Update name in case of typo, but stick to roll no.
    }

    // Send initial state
    const timeRemaining = state.isExamStarted 
      ? Math.max(0, state.examDuration - Math.floor((Date.now() - state.examStartTime) / 1000))
      : state.examDuration;

    callback({
      success: true,
      student,
      examStatus: { started: state.isExamStarted, timeRemaining, config }
    });

    io.emit('admin_update', Object.values(state.students));
  });

  // Admin joining
  socket.on('join_admin', () => {
    socket.emit('admin_update', Object.values(state.students));
    socket.emit('admin_state', { isExamStarted: state.isExamStarted });
  });

  // Student updates an answer or changes question status
  socket.on('update_answer', ({ rollNo, qId, option, status }) => {
    const student = state.students[rollNo];
    if (student) {
      student.answers[qId] = { option, status };
      student.score = calculateScore(student.answers);
      io.emit('admin_update', Object.values(state.students));
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    const student = Object.values(state.students).find(s => s.socketId === socket.id);
    if (student) {
      student.connected = false;
      io.emit('admin_update', Object.values(state.students));
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

const name = sessionStorage.getItem('studentName');
const rollNo = sessionStorage.getItem('rollNo');

if (!name || !rollNo) {
    window.location.href = 'index.html';
}

document.getElementById('candidateNameDisplay').innerText = name;
document.getElementById('candidateRollDisplay').innerText = `Roll No: ${rollNo}`;

const socket = io();
let examData = null; // To hold questions from API
let studentData = null; // To hold answers
let currentSection = null;
let currentQuestionIndex = 0;
let timerInterval = null;
let timeRemaining = 0;

// Connect and Setup
async function initExam() {
    try {
        const res = await fetch('/api/questions');
        const data = await res.json();
        examData = data.questions;
        updateMarkingDisplay(data.config);
    } catch (err) {
        console.error("Failed to load questions", err);
    }

    socket.emit('join_exam', { name, rollNo }, (response) => {
        if (response.success) {
            studentData = response.student;
            if (response.examStatus.config) updateMarkingDisplay(response.examStatus.config);
            handleExamStatus(response.examStatus);
            if (response.examStatus.started) {
                renderSections();
            }
        }
    });
}

function updateMarkingDisplay(config) {
    if (config) {
        const el = document.getElementById('markingSchemeDisplay');
        if (el) el.innerText = `Single Correct Option (+${config.posMark}, -${config.negMark})`;
    }
}

function handleExamStatus(status) {
    if (status.started) {
        document.getElementById('waitOverlay').style.display = 'none';
        timeRemaining = status.timeRemaining;
        startTimer();
    } else {
        document.getElementById('waitOverlay').style.display = 'flex';
    }
}

socket.on('exam_started', (data) => {
    handleExamStatus({ started: true, timeRemaining: data.duration });
    renderSections();
});

socket.on('exam_ended', () => {
    clearInterval(timerInterval);
    document.getElementById('endOverlay').style.display = 'flex';
});

// Timer Logic
function startTimer() {
    clearInterval(timerInterval);
    updateTimerDisplay();
    timerInterval = setInterval(() => {
        if (timeRemaining > 0) {
            timeRemaining--;
            updateTimerDisplay();
        } else {
            clearInterval(timerInterval);
            document.getElementById('endOverlay').style.display = 'flex';
        }
    }, 1000);
}

function updateTimerDisplay() {
    const hrs = Math.floor(timeRemaining / 3600).toString().padStart(2, '0');
    const mins = Math.floor((timeRemaining % 3600) / 60).toString().padStart(2, '0');
    const secs = (timeRemaining % 60).toString().padStart(2, '0');
    document.getElementById('globalTimer').innerText = `${hrs}:${mins}:${secs}`;
}

// Rendering Logic
function renderSections() {
    const sectionsContainer = document.getElementById('sectionsContainer');
    sectionsContainer.innerHTML = '';
    
    const sections = Object.keys(examData);
    if (!currentSection && sections.length > 0) {
        currentSection = sections[0];
    }

    sections.forEach(sec => {
        const tab = document.createElement('div');
        tab.className = `section-tab ${sec === currentSection ? 'active' : ''}`;
        tab.innerText = sec;
        tab.onclick = () => {
            currentSection = sec;
            currentQuestionIndex = 0;
            renderSections();
            renderQuestion();
            renderPalette();
        };
        sectionsContainer.appendChild(tab);
    });

    renderQuestion();
    renderPalette();
}

function renderQuestion() {
    const qs = examData[currentSection];
    if (!qs || qs.length === 0) return;
    
    const q = qs[currentQuestionIndex];
    document.getElementById('qNumberDisplay').innerText = currentQuestionIndex + 1;
    document.getElementById('questionText').innerText = q.text;

    const optionsContainer = document.getElementById('optionsContainer');
    optionsContainer.innerHTML = '';

    const ansData = studentData.answers[q.id];
    let selectedOption = ansData ? ansData.option : null;

    // Mark as visited if not visited yet
    if (!ansData) {
        saveAnswer(q.id, null, 'not_answered');
    } else if (ansData.status === 'not_visited') {
        saveAnswer(q.id, selectedOption, 'not_answered');
    }

    q.options.forEach((opt, index) => {
        const optDiv = document.createElement('div');
        optDiv.className = `option ${selectedOption === index ? 'selected' : ''}`;
        
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `question_${q.id}`;
        radio.value = index;
        if (selectedOption === index) radio.checked = true;

        radio.onclick = (e) => e.stopPropagation(); // prevent double trigger
        optDiv.onclick = () => {
            document.querySelectorAll('.option').forEach(el => el.classList.remove('selected'));
            optDiv.classList.add('selected');
            radio.checked = true;
        };

        const label = document.createElement('span');
        label.innerText = opt;

        optDiv.appendChild(radio);
        optDiv.appendChild(label);
        optionsContainer.appendChild(optDiv);
    });
}

function renderPalette() {
    const paletteGrid = document.getElementById('paletteGrid');
    paletteGrid.innerHTML = '';

    const qs = examData[currentSection];
    if (!qs) return;

    qs.forEach((q, idx) => {
        const ansData = studentData.answers[q.id];
        const status = ansData ? ansData.status : 'not_visited';
        
        const btn = document.createElement('div');
        btn.className = `palette-btn status-${status}`;
        btn.innerHTML = `<span>${idx + 1}</span>`;
        if (idx === currentQuestionIndex) {
            btn.style.boxShadow = '0 0 0 2px #3b82f6';
        }

        btn.onclick = () => {
            currentQuestionIndex = idx;
            renderQuestion();
            renderPalette();
        };
        paletteGrid.appendChild(btn);
    });
}

function getSelectedOption() {
    const qs = examData[currentSection];
    const q = qs[currentQuestionIndex];
    const checked = document.querySelector(`input[name="question_${q.id}"]:checked`);
    return checked ? parseInt(checked.value) : null;
}

function saveAnswer(qId, option, status) {
    if (!studentData.answers[qId]) {
        studentData.answers[qId] = {};
    }
    studentData.answers[qId] = { option, status };
    socket.emit('update_answer', { rollNo, qId, option, status });
    renderPalette();
}

function goNextQuestion() {
    const qs = examData[currentSection];
    if (currentQuestionIndex < qs.length - 1) {
        currentQuestionIndex++;
    } else {
        // Move to next section
        const sections = Object.keys(examData);
        const currSecIdx = sections.indexOf(currentSection);
        if (currSecIdx < sections.length - 1) {
            currentSection = sections[currSecIdx + 1];
            currentQuestionIndex = 0;
            renderSections();
            return;
        }
    }
    renderQuestion();
    renderPalette();
}

// Button Handlers
document.getElementById('btnSaveNext').onclick = () => {
    const qId = examData[currentSection][currentQuestionIndex].id;
    const selected = getSelectedOption();
    const status = selected !== null ? 'answered' : 'not_answered';
    saveAnswer(qId, selected, status);
    goNextQuestion();
};

document.getElementById('btnClear').onclick = () => {
    const qId = examData[currentSection][currentQuestionIndex].id;
    saveAnswer(qId, null, 'not_answered');
    renderQuestion();
};

document.getElementById('btnMarkReview').onclick = () => {
    const qId = examData[currentSection][currentQuestionIndex].id;
    const selected = getSelectedOption();
    const status = selected !== null ? 'marked_answered' : 'marked';
    saveAnswer(qId, selected, status);
    goNextQuestion();
};

document.getElementById('btnSubmitTest').onclick = () => {
    if(confirm("Are you sure you want to submit the test?")) {
        document.getElementById('endOverlay').style.display = 'flex';
    }
};

// Start
initExam();

const socket = io();

// Auth Logic
const authOverlay = document.getElementById('adminAuthOverlay');
const loginBtn = document.getElementById('btnAdminLogin');
const passInput = document.getElementById('adminPassInput');
const errorMsg = document.getElementById('authErrorMsg');

function checkAuth() {
    const isAuth = sessionStorage.getItem('adminAuth') === 'true';
    if (isAuth) {
        unlockDashboard();
    }
}

function unlockDashboard() {
    authOverlay.style.display = 'none';
    document.body.style.overflow = 'auto';
    document.querySelector('.admin-header').style.visibility = 'visible';
    document.querySelector('.tabs').style.visibility = 'visible';
    
    // Join Admin and Init
    socket.emit('join_admin');
    fetchConfig();
}

loginBtn.addEventListener('click', async () => {
    const password = passInput.value;
    try {
        const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (data.success) {
            sessionStorage.setItem('adminAuth', 'true');
            unlockDashboard();
        } else {
            errorMsg.innerText = data.error || "Login Failed";
        }
    } catch (e) {
        errorMsg.innerText = "Error connecting to server";
    }
});

passInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loginBtn.click();
});

let isExamStarted = false;
let currentQuestions = {};
let currentTeams = {};

function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.dashboard-content, .config-content').forEach(c => c.classList.remove('active-content'));
    
    document.querySelector(`.tab-btn[onclick="switchTab('${tabId}')"]`).classList.add('active');
    document.getElementById(tabId).classList.add('active-content');
}

// Removed direct call: socket.emit('join_admin');

socket.on('admin_state', (state) => {
    isExamStarted = state.isExamStarted;
    updateExamButton();
    toggleConfigState();
});

socket.on('admin_update', (students) => {
    renderDashboard(students);
});

async function fetchConfig() {
    try {
        const res = await fetch('/api/admin/config');
        const data = await res.json();
        document.getElementById('confDuration').value = data.config.duration;
        document.getElementById('confPosMark').value = data.config.posMark;
        document.getElementById('confNegMark').value = data.config.negMark;
        currentQuestions = data.questions;
        currentTeams = data.authorizedTeams || {};
        renderQuestionsManager();
        renderTeamsManager();
    } catch (e) { console.error(e); }
}

document.getElementById('toggleExamBtn').addEventListener('click', async () => {
    try {
        const res = await fetch('/api/admin/toggle-exam', { method: 'POST' });
        const data = await res.json();
        isExamStarted = data.started;
        updateExamButton();
        toggleConfigState();
    } catch (err) { console.error(err); }
});

function updateExamButton() {
    const btn = document.getElementById('toggleExamBtn');
    const statusText = document.getElementById('examStatusDisplay');
    if (isExamStarted) {
        btn.textContent = "Stop Exam"; btn.className = "btn btn-stop"; statusText.textContent = "Exam: RUNNING";
    } else {
        btn.textContent = "Start Exam"; btn.className = "btn btn-start"; statusText.textContent = "Exam: STOPPED";
    }
}

function toggleConfigState() {
    const overlay = document.getElementById('configOverlayMsg');
    const inputs = document.querySelectorAll('#config input, #config select, #config button');
    if (isExamStarted) {
        overlay.style.display = 'block';
        inputs.forEach(i => i.disabled = true);
    } else {
        overlay.style.display = 'none';
        inputs.forEach(i => i.disabled = false);
    }
}

document.getElementById('btnSaveConfig').addEventListener('click', async () => {
    const newConfig = {
        duration: document.getElementById('confDuration').value,
        posMark: document.getElementById('confPosMark').value,
        negMark: document.getElementById('confNegMark').value,
    };
    try {
        await fetch('/api/admin/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newConfig })
        });
        alert('Global Settings Saved!');
    } catch (e) { alert('Failed to save config'); }
});

document.getElementById('btnAddQuestion').addEventListener('click', async () => {
    const section = document.getElementById('addQSection').value;
    const text = document.getElementById('addQText').value;
    const answer = document.getElementById('addQAnswer').value;
    const options = [
        document.getElementById('addQOpt0').value,
        document.getElementById('addQOpt1').value,
        document.getElementById('addQOpt2').value,
        document.getElementById('addQOpt3').value,
    ];

    if (!text || options.some(o => !o)) return alert("Please fill all fields.");

    try {
        const res = await fetch('/api/admin/add-question', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section, text, options, answer })
        });
        const data = await res.json();
        if (data.success) {
            currentQuestions = data.questions;
            renderQuestionsManager();
            document.getElementById('addQText').value = '';
            document.querySelectorAll('.add-q-options input').forEach(i => i.value = '');
            alert('Question Added!');
        }
    } catch (e) { alert('Failed to add question'); }
});

function renderQuestionsManager() {
    const list = document.getElementById('questionsListPreview');
    list.innerHTML = '';
    for (const section in currentQuestions) {
        const h4 = document.createElement('h4');
        h4.innerText = section;
        list.appendChild(h4);
        
        currentQuestions[section].forEach((q, idx) => {
            const div = document.createElement('div');
            div.className = 'q-item';
            div.innerHTML = `
                <div class="q-item-header">
                    <span>Q${idx + 1}: ${q.text}</span> 
                    <div>
                        <span style="color:#22c55e; margin-right: 1rem;">Ans: Option ${q.answer + 1}</span>
                        <button class="btn btn-stop" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;" onclick="deleteQuestion('${section}', '${q.id}')">Delete</button>
                    </div>
                </div>
                <div class="q-item-body">
                    Options: ${q.options.join(' | ')}
                </div>
            `;
            list.appendChild(div);
        });
    }
}

function renderDashboard(students) {
    students.sort((a, b) => b.score - a.score);
    const tbody = document.getElementById('studentTableBody');
    tbody.innerHTML = '';
    let onlineCount = 0; let maxScore = 0;

    students.forEach(student => {
        if (student.connected) onlineCount++;
        if (student.score > maxScore) maxScore = student.score;

        const attempted = Object.values(student.answers).filter(a => a.status === 'answered' || a.status === 'marked_answered').length;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="status-dot ${student.connected ? 'status-online' : 'status-offline'}"></span>${student.connected ? 'Online' : 'Offline'}</td>
            <td>${student.rollNo}</td>
            <td><strong>${student.name}</strong></td>
            <td>${attempted}</td>
            <td class="score">${student.score}</td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('totalStudents').textContent = students.length;
    document.getElementById('onlineStudents').textContent = onlineCount;
    document.getElementById('highestScore').textContent = maxScore;
}

window.deleteQuestion = async function(section, id) {
    if (!confirm('Are you sure you want to delete this question?')) return;
    try {
        const res = await fetch('/api/admin/delete-question', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ section, id })
        });
        const data = await res.json();
        if (data.success) {
            currentQuestions = data.questions;
            renderQuestionsManager();
        } else {
            alert(data.error || 'Failed to delete');
        }
    } catch(e) { alert('Failed to delete question'); }
};

document.getElementById('btnAddTeam').addEventListener('click', async () => {
    const name = document.getElementById('addTeamName').value.trim();
    const rollNo = document.getElementById('addTeamRoll').value.trim();
    if(!name || !rollNo) return alert("Please enter both Name and Roll Number");

    try {
        const res = await fetch('/api/admin/add-team', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, rollNo })
        });
        const data = await res.json();
        if(data.success) {
            currentTeams = data.authorizedTeams;
            renderTeamsManager();
            document.getElementById('addTeamName').value = '';
            document.getElementById('addTeamRoll').value = '';
        }
    } catch(e) { alert('Failed to authorize candidate'); }
});

window.deleteTeam = async function(rollNo) {
    if(!confirm("Remove this candidate's authorization?")) return;
    try {
        const res = await fetch('/api/admin/delete-team', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rollNo })
        });
        const data = await res.json();
        if(data.success) {
            currentTeams = data.authorizedTeams;
            renderTeamsManager();
        }
    } catch(e) { alert('Failed to remove candidate'); }
};

function renderTeamsManager() {
    const tbody = document.getElementById('authorizedTeamsBody');
    tbody.innerHTML = '';
    Object.values(currentTeams).forEach(team => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${team.rollNo}</td>
            <td><strong>${team.name}</strong></td>
            <td><button class="btn btn-stop" style="padding: 0.2rem 0.5rem; font-size: 0.8rem;" onclick="deleteTeam('${team.rollNo}')">Remove</button></td>
        `;
        tbody.appendChild(tr);
    });
}

// Init
checkAuth();

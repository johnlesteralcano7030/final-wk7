let token = localStorage.getItem('token');
let userRole = localStorage.getItem('role');
let username = localStorage.getItem('username');

// --- AUTHENTICATION ---
async function login() {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    const errorText = document.getElementById('login-error');

    // Check if fields are empty
    if (!user || !pass) {
        errorText.innerText = "Please enter both username and password.";
        return;
    }

    try {
        // Show a loading message
        errorText.innerText = "Connecting...";
        errorText.style.color = "blue";

        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });

        const data = await res.json();

        if (res.ok) {
            // Success!
            localStorage.setItem('token', data.token);
            localStorage.setItem('role', data.role);
            localStorage.setItem('username', data.username);
            window.location.reload();
        } else {
            // Wrong password / user not found
            errorText.innerText = data.message || "Invalid credentials";
            errorText.style.color = "red";
        }
    } catch (error) {
        // Server is down or network error
        console.error("Login Error:", error);
        errorText.innerText = "Cannot connect to server. Is 'node server.js' still running?";
        errorText.style.color = "red";
    }
}

function logout() {
    localStorage.clear();
    window.location.reload();
}

// --- UI ROUTING ---
function initDashboard() {
    if (!token) {
        document.getElementById('login-view').classList.remove('hidden');
        document.getElementById('dashboard-view').classList.add('hidden');
        return;
    }
    
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('dashboard-view').classList.remove('hidden');
    document.getElementById('welcome-text').innerText = `Welcome, ${username} (${userRole})`;

    // Hide all sections
    document.querySelectorAll('.role-section').forEach(el => el.classList.add('hidden'));

    if (userRole === 'borrower') {
        document.getElementById('borrower-section').classList.remove('hidden');
        loadBorrowerData();
    } else if (userRole === 'dept_head') {
        document.getElementById('depthead-section').classList.remove('hidden');
        loadDeptHeadData();
    } else if (userRole === 'admin') {
        document.getElementById('admin-section').classList.remove('hidden');
        loadAdminData();
    }
}

// Helper fetch header
const authHeader = () => ({ 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' });

// --- BORROWER LOGIC ---
async function loadBorrowerData() {
    // Load Items
    const itemsRes = await fetch('/api/items', { headers: authHeader() });
    const items = await itemsRes.json();
    const itemsBody = document.querySelector('#items-table tbody');
    itemsBody.innerHTML = items.map(item => `
        <tr>
            <td>${item.name}</td>
            <td>${item.available_quantity}</td>
            <td><button onclick="requestItem(${item.id})">Borrow</button></td>
        </tr>
    `).join('');

    // Load My Requests
    const reqRes = await fetch('/api/requests', { headers: authHeader() });
    const reqs = await reqRes.json();
    const reqBody = document.querySelector('#my-requests-table tbody');
    reqBody.innerHTML = reqs.map(r => `
        <tr>
            <td>${r.item_name}</td>
            <td>${r.quantity}</td>
            <td><span class="badge ${r.status}">${r.status}</span></td>
            <td>${r.return_date || 'N/A'}</td>
        </tr>
    `).join('');
}

async function requestItem(itemId) {
    const qty = prompt("Enter quantity to borrow:", "1");
    if (!qty) return;

    const res = await fetch('/api/requests', {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ item_id: itemId, quantity: parseInt(qty) })
    });
    const data = await res.json();
    alert(data.message);
    loadBorrowerData();
}

// --- DEPT HEAD LOGIC ---
async function loadDeptHeadData() {
    const res = await fetch('/api/requests', { headers: authHeader() });
    const reqs = await res.json();
    const pendingReqs = reqs.filter(r => r.status === 'PENDING_HEAD');
    
    const body = document.querySelector('#head-requests-table tbody');
    body.innerHTML = pendingReqs.map(r => `
        <tr>
            <td>${r.id}</td>
            <td>${r.borrower}</td>
            <td>${r.item_name}</td>
            <td>${r.quantity}</td>
            <td>
                <button class="btn-approve" onclick="actionRequest(${r.id}, 'approve')">Approve</button>
                <button class="btn-deny" onclick="actionRequest(${r.id}, 'deny')">Deny</button>
            </td>
        </tr>
    `).join('');
}

async function actionRequest(reqId, action) {
    const res = await fetch(`/api/requests/${reqId}/action`, {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ action })
    });
    const data = await res.json();
    alert(data.message);
    loadDeptHeadData();
}

// --- ADMIN (PCO) LOGIC ---
async function loadAdminData() {
    // Load Inventory
    const itemsRes = await fetch('/api/items', { headers: authHeader() });
    const items = await itemsRes.json();
    document.querySelector('#admin-items-table tbody').innerHTML = items.map(i => `
        <tr><td>${i.id}</td><td>${i.name}</td><td>${i.total_quantity}</td><td>${i.available_quantity}</td></tr>
    `).join('');

    // Load Requests
    const reqRes = await fetch('/api/requests', { headers: authHeader() });
    const reqs = await reqRes.json();
    document.querySelector('#admin-requests-table tbody').innerHTML = reqs.map(r => {
        let actionBtn = '';
        if (r.status === 'APPROVED') {
            actionBtn = `<button onclick="releaseItem(${r.id})">Release</button>`;
        } else if (r.status === 'RELEASED') {
            actionBtn = `<button onclick="returnItem(${r.id})">Mark Returned</button>`;
        }
        
        return `
        <tr>
            <td>${r.id}</td>
            <td>${r.borrower}</td>
            <td>${r.item_name}</td>
            <td>${r.quantity}</td>
            <td><span class="badge ${r.status}">${r.status}</span></td>
            <td>${actionBtn}</td>
        </tr>`;
    }).join('');

    // Load Logs
    const logsRes = await fetch('/api/logs', { headers: authHeader() });
    const logs = await logsRes.json();
    document.querySelector('#logs-table tbody').innerHTML = logs.map(l => `
        <tr>
            <td>${l.id}</td><td>${l.request_id}</td><td>${l.action}</td>
            <td>${l.performed_by}</td><td>${l.timestamp}</td>
        </tr>
    `).join('');
}

async function releaseItem(reqId) {
    const date = prompt("Enter return date (YYYY-MM-DD):", "2026-10-30");
    if (!date) return;
    const res = await fetch(`/api/requests/${reqId}/release`, {
        method: 'POST', headers: authHeader(), body: JSON.stringify({ return_date: date })
    });
    alert((await res.json()).message);
    loadAdminData();
}

async function returnItem(reqId) {
    const res = await fetch(`/api/requests/${reqId}/return`, {
        method: 'POST', headers: authHeader()
    });
    alert((await res.json()).message);
    loadAdminData();
}

async function addItem() {
    const name = document.getElementById('new-item-name').value;
    const qty = document.getElementById('new-item-qty').value;
    if (!name || !qty) return;

    await fetch('/api/items', {
        method: 'POST',
        headers: authHeader(),
        body: JSON.stringify({ name, total_quantity: parseInt(qty) })
    });
    document.getElementById('new-item-name').value = '';
    document.getElementById('new-item-qty').value = '';
    loadAdminData();
}

// Initialize on load
initDashboard();
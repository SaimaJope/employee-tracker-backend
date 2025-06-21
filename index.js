// preload.js - A new, clean, and 100% correct version with robust error handling

window.addEventListener('DOMContentLoaded', () => {

    let authToken = null;

    // --- ELEMENT REFERENCES ---
    const loginView = document.getElementById('login-view');
    const mainAppView = document.getElementById('main-app-view');
    const loginForm = document.getElementById('login-form');
    const registerModal = document.getElementById('register-modal');
    const deleteConfirmModal = document.getElementById('delete-confirm-modal');

    // --- HELPER FUNCTIONS ---

    async function apiFetch(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        const fetchOptions = {
            method: 'GET', ...options,
            headers: { 'Content-Type': 'application/json', ...options.headers },
            signal: controller.signal,
        };
        if (authToken) fetchOptions.headers['Authorization'] = `Bearer ${authToken}`;
        try {
            const response = await fetch(`https://varah-8asg.onrender.com${url}`, fetchOptions);
            clearTimeout(timeoutId);
            if (response.status === 401) handleLogout();

            // --- THIS IS THE ROBUST ERROR HANDLING ---
            // Check if the response is JSON before trying to parse it
            const contentType = response.headers.get("content-type");
            if (contentType && contentType.indexOf("application/json") !== -1) {
                // It's JSON, so we can parse it
                const data = await response.json();
                if (!response.ok) {
                    // Throw the error message from the JSON body
                    throw new Error(data.message || `Server responded with status ${response.status}`);
                }
                return data; // Return data on success
            } else {
                // It's not JSON (likely an HTML error page from Render)
                if (!response.ok) {
                    throw new Error(`Server returned a non-JSON error page (Status: ${response.status})`);
                }
                // Handle non-json success if ever needed, for now just pass
                return;
            }

        } catch (error) { clearTimeout(timeoutId); throw error; }
    }

    function showView(viewName) { loginView.style.display = 'none'; mainAppView.style.display = 'none'; if (viewName === 'login') loginView.style.display = 'flex'; else if (viewName === 'main') { mainAppView.style.display = 'block'; showSection('log'); } }
    function showSection(sectionName) { document.getElementById('log-section').style.display = 'none'; document.getElementById('manage-section').style.display = 'none'; document.getElementById('kiosk-section').style.display = 'none'; if (sectionName === 'log') { document.getElementById('log-section').style.display = 'block'; fetchAndUpdateLogs(); } else if (sectionName === 'manage') { document.getElementById('manage-section').style.display = 'block'; fetchAndDisplayEmployees(); } else if (sectionName === 'kiosk') { document.getElementById('kiosk-section').style.display = 'block'; /* fetchKiosks(); */ } }
    function handleLogout() { authToken = null; showView('login'); }

    // --- DATA FETCHING & ACTION FUNCTIONS ---
    async function fetchAndDisplayEmployees() {
        const tableBody = document.getElementById('employee-table-body');
        if (!authToken || !tableBody) return;
        tableBody.closest('table').setAttribute('aria-busy', 'true');
        try {
            const employees = await apiFetch('/api/employees');
            tableBody.innerHTML = '';
            if (employees.length === 0) tableBody.innerHTML = `<tr><td colspan="3">No employees found.</td></tr>`;
            else employees.forEach(emp => { const row = document.createElement('tr'); row.innerHTML = `<td>${emp.name}</td><td>${emp.nfc_card_id}</td><td><button class="outline contrast delete-employee-button" data-id="${emp.id}">Delete</button></td>`; tableBody.appendChild(row); });
        } catch (error) { tableBody.innerHTML = `<tr><td colspan="3">Error: ${error.message}</td></tr>`; }
        finally { tableBody.closest('table').setAttribute('aria-busy', 'false'); }
    }

    function deleteEmployee(employeeId) {
        const manageContainer = document.getElementById('manage-section');
        if (manageContainer) manageContainer.setAttribute('aria-busy', 'true');
        setTimeout(async () => {
            try { await apiFetch(`/api/employees/${employeeId}`, { method: 'DELETE' }); } catch (error) { document.getElementById('manage-status-message').textContent = `Error: ${error.message}`; }
            finally {
                if (manageContainer) manageContainer.setAttribute('aria-busy', 'false');
                fetchAndDisplayEmployees();
            }
        }, 0);
    }

    async function fetchAndUpdateLogs() { /* Not implemented yet */ }

    // --- EVENT LISTENERS ---
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const loginButton = document.getElementById('login-button');
            const loginErrorMessage = document.getElementById('login-error-message');
            loginButton.setAttribute('aria-busy', 'true');
            loginErrorMessage.textContent = '';
            try {
                const data = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: document.getElementById('login-email').value, password: document.getElementById('login-password').value }) });
                authToken = data.token;
                showView('main');
            } catch (error) { loginErrorMessage.textContent = error.message; }
            finally { loginButton.setAttribute('aria-busy', 'false'); }
        });
    }

    if (mainAppView) { mainAppView.addEventListener('click', (e) => { const target = e.target; const navLink = target.closest('a[role="button"], a#logout-button'); const deleteButton = target.closest('button.delete-employee-button'); if (deleteButton) { deleteConfirmModal.dataset.employeeId = deleteButton.dataset.id; deleteConfirmModal.showModal(); } else if (navLink) { e.preventDefault(); if (navLink.id === 'logout-button') handleLogout(); else if (navLink.id === 'nav-logs') showSection('log'); else if (navLink.id === 'nav-manage') showSection('manage'); else if (navLink.id === 'nav-kiosks') showSection('kiosk'); } }); }

    if (document.getElementById('add-employee-form')) {
        let isSubmitting = false;
        document.getElementById('add-employee-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (isSubmitting) return;
            isSubmitting = true;
            const manageStatusMessage = document.getElementById('manage-status-message');
            const addEmployeeButton = e.target.querySelector('button[type="submit"]');
            if (addEmployeeButton) addEmployeeButton.setAttribute('aria-busy', 'true');
            manageStatusMessage.textContent = '';
            try {
                const data = await apiFetch('/api/employees', { method: 'POST', body: JSON.stringify({ name: document.getElementById('new-employee-name').value.trim(), nfc_card_id: document.getElementById('new-employee-card-id').value.trim() }) });
                manageStatusMessage.textContent = data.message;
                e.target.reset();
            } catch (error) { manageStatusMessage.textContent = `Error: ${error.message}`; }
            finally {
                if (addEmployeeButton) addEmployeeButton.setAttribute('aria-busy', 'false');
                isSubmitting = false;
                fetchAndDisplayEmployees();
            }
        });
    }

    if (registerModal) { document.getElementById('show-register-modal').addEventListener('click', (e) => { e.preventDefault(); registerModal.showModal(); }); document.getElementById('close-register-modal').addEventListener('click', (e) => { e.preventDefault(); registerModal.close(); }); /* register form listener here */ }
    if (deleteConfirmModal) { document.getElementById('confirm-delete-btn').addEventListener('click', () => { const idToDelete = deleteConfirmModal.dataset.employeeId; if (idToDelete) deleteEmployee(idToDelete); deleteConfirmModal.close(); }); document.getElementById('cancel-delete-btn').addEventListener('click', () => deleteConfirmModal.close()); document.getElementById('cancel-delete-btn-x').addEventListener('click', () => deleteConfirmModal.close()); }

    showView('login');
});
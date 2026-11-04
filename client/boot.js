const participant = location.pathname === '/participant';
if (participant) document.body.dataset.participant = '';
await import(participant ? './participant.js' : './app.js');

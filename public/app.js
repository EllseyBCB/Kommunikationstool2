const scenarios = {
  bewerbung: {
    title: 'Bewerbungsgespräch',
    text: 'Hier übst du typische Fragen aus dem Vorstellungsgespräch, zum Beispiel zu deinen Stärken, Schwächen und deiner Motivation. Ziel ist es, selbstsicher und klar zu antworten.'
  },
  sales: {
    title: 'Sales-Pitch',
    text: 'In diesem Szenario trainierst du, ein Produkt oder eine Idee überzeugend zu präsentieren. Du übst, Nutzen klar zu kommunizieren und auf Einwände souverän zu reagieren.'
  },
  gehalt: {
    title: 'Gehaltsverhandlung',
    text: 'Hier lernst du, sicher über dein Gehalt zu sprechen. Du übst, deine Leistung zu argumentieren und angemessen auf Gegenangebote zu reagieren.'
  }
};

const cards = document.querySelectorAll('.scenario-card');
const detailPanel = document.getElementById('detail');
const detailTitle = document.getElementById('detailTitle');
const detailText = document.getElementById('detailText');
const backButton = document.getElementById('backButton');
const scenarioGrid = document.querySelector('.scenario-grid');

cards.forEach((card) => {
  card.addEventListener('click', () => {
    const key = card.dataset.scenario;
    const scenario = scenarios[key];
    if (!scenario) return;

    detailTitle.textContent = scenario.title;
    detailText.textContent = scenario.text;

    detailPanel.classList.remove('hidden');
    scenarioGrid.classList.add('hidden');
    detailPanel.scrollIntoView({ behavior: 'smooth' });
  });
});

backButton.addEventListener('click', () => {
  detailPanel.classList.add('hidden');
  scenarioGrid.classList.remove('hidden');
});

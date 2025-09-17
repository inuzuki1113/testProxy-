document.getElementById('searchForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const query = document.getElementById('searchInput').value;
  if(!query) return;
  const url = `/proxy?url=${encodeURIComponent('https://www.youtube.com/results?search_query='+encodeURIComponent(query))}`;
  const res = await fetch(url);
  const html = await res.text();
  document.getElementById('results').innerHTML = html;
});

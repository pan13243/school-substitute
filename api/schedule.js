const { supabase, memoryStore } = require('./supabase-client');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      let records = [];
      if (supabase) {
        const { data, error } = await supabase.from('schedule').select('*');
        if (error) throw error;
        records = data || [];
      } else {
        records = memoryStore.schedule;
      }
      return res.json({ success: true, data: records });
    }

    if (req.method === 'POST') {
      const { records } = req.body;
      if (!records || !Array.isArray(records)) {
        return res.status(400).json({ success: false, error: '需要 records 数组' });
      }

      if (supabase) {
        const { error } = await supabase.from('schedule').delete().neq('id', 0);
        if (error) throw error;
        if (records.length > 0) {
          const { error: insertError } = await supabase.from('schedule').insert(records);
          if (insertError) throw insertError;
        }
      } else {
        memoryStore.schedule = records;
      }
      return res.json({ success: true, count: records.length });
    }

    if (req.method === 'DELETE') {
      if (supabase) {
        const { error } = await supabase.from('schedule').delete().neq('id', 0);
        if (error) throw error;
      } else {
        memoryStore.schedule = [];
      }
      return res.json({ success: true });
    }

    res.status(405).json({ success: false, error: '不支持的方法' });
  } catch (error) {
    console.error('Schedule API error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
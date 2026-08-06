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
        const { data, error } = await supabase.from('leave_records').select('*');
        if (error) throw error;
        records = data || [];
      } else {
        records = memoryStore.leaves;
      }
      return res.json({ success: true, data: records });
    }

    if (req.method === 'POST') {
      const { leave } = req.body;
      if (!leave) return res.status(400).json({ success: false, error: '需要 leave 对象' });

      if (supabase) {
        const { data, error } = await supabase.from('leave_records').insert([leave]).select();
        if (error) throw error;
        return res.status(201).json({ success: true, id: data[0].id });
      } else {
        leave.id = Date.now();
        memoryStore.leaves.push(leave);
        return res.status(201).json({ success: true, id: leave.id });
      }
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (supabase) {
        if (id) {
          const { error } = await supabase.from('leave_records').delete().eq('id', id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('leave_records').delete().neq('id', 0);
          if (error) throw error;
        }
      } else {
        if (id) {
          memoryStore.leaves = memoryStore.leaves.filter(l => l.id != id);
        } else {
          memoryStore.leaves = [];
        }
      }
      return res.json({ success: true });
    }

    res.status(405).json({ success: false, error: '不支持的方法' });
  } catch (error) {
    console.error('Leaves API error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};
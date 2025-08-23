#!/bin/bash

echo "🔍 Monitoring PostgreSQL YJS Updates Table"
echo "========================================="
echo "Press Ctrl+C to stop monitoring"
echo ""

while true; do
    clear
    echo "🔍 PostgreSQL YJS Updates Monitor - $(date)"
    echo "========================================="
    
    # Show recent updates
    docker exec annotation_postgres psql -U postgres -d annotation_system -c "
    SELECT 
        id,
        doc_name,
        client_id,
        timestamp,
        octet_length(update) as update_size
    FROM yjs_updates 
    ORDER BY timestamp DESC 
    LIMIT 10;
    "
    
    # Show summary
    docker exec annotation_postgres psql -U postgres -d annotation_system -t -c "
    SELECT 
        'Total Updates: ' || COUNT(*) || 
        ', Unique Docs: ' || COUNT(DISTINCT doc_name) ||
        ', Latest: ' || MAX(timestamp)::timestamp(0)
    FROM yjs_updates;
    "
    
    sleep 2
done
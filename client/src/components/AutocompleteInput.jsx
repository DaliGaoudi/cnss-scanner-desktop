import React, { useState, useEffect, useRef } from 'react';
import API_BASE from '../config';

export default function AutocompleteInput({ 
    value, 
    onChange, 
    placeholder, 
    className = "", 
    style = {},
    required = false 
}) {
    const [suggestions, setSuggestions] = useState([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loading, setLoading] = useState(false);
    const wrapperRef = useRef(null);

    // Debounce the fetching
    useEffect(() => {
        const fetchSuggestions = async () => {
            if (!value || value.trim().length === 0) {
                setSuggestions([]);
                return;
            }
            setLoading(true);
            try {
                const token = localStorage.getItem('token');
                const res = await fetch(`${API_BASE}/suggestions/names?q=${encodeURIComponent(value)}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if (data.success && data.data) {
                    setSuggestions(data.data.filter(n => n !== value));
                }
            } catch (err) {
                console.error("Failed to fetch suggestions:", err);
            }
            setLoading(false);
        };

        const timerId = setTimeout(() => {
            fetchSuggestions();
        }, 300); // 300ms debounce

        return () => clearTimeout(timerId);
    }, [value]);

    // Close dropdown on click outside
    useEffect(() => {
        function handleClickOutside(event) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
                setShowDropdown(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);

    const handleSelect = (name) => {
        onChange({ target: { value: name } });
        setShowDropdown(false);
    };

    const handleFocus = () => {
        if (suggestions.length > 0) setShowDropdown(true);
    };

    const handleChange = (e) => {
        onChange(e);
        setShowDropdown(true);
    };

    return (
        <div ref={wrapperRef} style={{ position: 'relative', width: '100%', flex: 1 }}>
            <input 
                type="text"
                value={value}
                onChange={handleChange}
                onFocus={handleFocus}
                placeholder={placeholder}
                className={className}
                style={{ width: '100%', ...style }}
                required={required}
            />
            {showDropdown && suggestions.length > 0 && (
                <ul style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    margin: 0,
                    padding: 0,
                    listStyle: 'none',
                    background: 'var(--card-bg)',
                    border: '1px solid var(--card-border)',
                    borderRadius: '8px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                    zIndex: 1000,
                    maxHeight: '200px',
                    overflowY: 'auto'
                }}>
                    {suggestions.map((s, i) => (
                        <li 
                            key={i} 
                            onClick={() => handleSelect(s)}
                            style={{
                                padding: '0.75rem 1rem',
                                cursor: 'pointer',
                                borderBottom: i < suggestions.length - 1 ? '1px solid var(--card-border)' : 'none',
                                color: 'var(--text-main)',
                                transition: 'background 0.2s',
                                display: 'flex',
                                alignItems: 'center'
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--surface-2)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                            {s}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

import { mount } from 'svelte';
import '../app.css';
import { applyTheme, resolveTheme } from '../lib/theme';
import type { ThemePref } from '../lib/types';
import Methodology from './Methodology.svelte';

// the map links here with ?theme=light|dark when the visitor chose one; otherwise follow the system
const t = new URLSearchParams(location.search).get('theme');
applyTheme(resolveTheme(t === 'light' || t === 'dark' ? (t as ThemePref) : 'system'));
mount(Methodology, { target: document.getElementById('app')! });

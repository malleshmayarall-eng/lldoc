/**
 * ChartCompiler — renders a single Plotly chart from the AI dashboard JSON config.
 *
 * The input API intentionally stays backward-compatible with the existing
 * server-generated config shape:
 *   { id, type, title, data: [...], config: { xAxisKey, bars/lines/areas/..., colors, ... } }
 */

import { memo, useMemo } from 'react';
import Plot from 'react-plotly.js';

const DEFAULT_COLORS = [
  '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#84cc16',
];

/** Large-dataset threshold — enable range slider above this */
const DATA_ZOOM_THRESHOLD = 50;

/**
 * Build Plotly traces + layout from the chart JSON config.
 * Keeps the same input API the AI generates so no prompt changes are needed.
 */
function buildPlotlySpec(type, safeData, config, colors) {
  const {
    xAxisKey = 'name',
    bars = [],
    lines = [],
    areas = [],
    dataKey = 'value',
    nameKey = 'name',
    showGrid = true,
    showLegend = true,
    showTooltip = true,
  } = config;

  const categoryData = safeData.map((d) => d[xAxisKey] ?? d[nameKey] ?? '');
  const useDataZoom = safeData.length > DATA_ZOOM_THRESHOLD;
  const baseLayout = {
    autosize: true,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    margin: { t: 24, r: 20, b: showLegend ? 56 : 36, l: 48 },
    showlegend: showLegend,
    legend: { orientation: 'h', y: -0.2, x: 0, font: { size: 11 } },
    hovermode: showTooltip ? 'closest' : false,
    font: { family: 'Inter, system-ui, sans-serif', size: 11, color: '#4b5563' },
  };

  const cartesianLayout = {
    ...baseLayout,
    xaxis: {
      type: 'category',
      automargin: true,
      tickangle: categoryData.length > 20 ? -45 : 0,
      showgrid: !!showGrid,
      gridcolor: '#f3f4f6',
      rangeslider: useDataZoom ? { visible: true, thickness: 0.08 } : undefined,
    },
    yaxis: {
      automargin: true,
      showgrid: !!showGrid,
      gridcolor: '#f3f4f6',
      zerolinecolor: '#e5e7eb',
    },
  };

  switch (type) {
    case 'bar': {
      const traces = bars.length > 0
        ? bars.map((b, i) => ({
            name: b.name || b.dataKey,
            type: 'bar',
            x: categoryData,
            y: safeData.map((d) => d[b.dataKey]),
            marker: { color: b.fill || colors[i % colors.length] },
          }))
        : [{
            type: 'bar',
            x: categoryData,
            y: safeData.map((d) => d[dataKey]),
            marker: { color: colors[0] },
          }];
      return { data: traces, layout: cartesianLayout };
    }

    case 'line': {
      const traces = lines.length > 0
        ? lines.map((l, i) => ({
            name: l.name || l.dataKey,
            type: 'line',
            mode: 'lines+markers',
            x: categoryData,
            y: safeData.map((d) => d[l.dataKey]),
            line: { color: l.stroke || colors[i % colors.length], width: 2, shape: 'spline' },
            marker: { color: l.stroke || colors[i % colors.length], size: 6 },
          }))
        : [{
            type: 'line',
            mode: 'lines+markers',
            x: categoryData,
            y: safeData.map((d) => d[dataKey]),
            line: { color: colors[0], width: 2, shape: 'spline' },
            marker: { color: colors[0], size: 6 },
          }];
      return { data: traces, layout: cartesianLayout };
    }

    case 'area': {
      const traces = areas.length > 0
        ? areas.map((a, i) => ({
            name: a.name || a.dataKey,
            type: 'scatter',
            mode: 'lines',
            fill: 'tozeroy',
            x: categoryData,
            y: safeData.map((d) => d[a.dataKey]),
            fillcolor: a.fill || colors[i % colors.length],
            line: { color: a.stroke || colors[i % colors.length], width: 2, shape: 'spline' },
          }))
        : [{
            type: 'scatter',
            mode: 'lines',
            fill: 'tozeroy',
            x: categoryData,
            y: safeData.map((d) => d[dataKey]),
            fillcolor: colors[0],
            line: { color: colors[0], width: 2, shape: 'spline' },
          }];
      return { data: traces, layout: cartesianLayout };
    }

    case 'pie':
      return {
        data: [{
          type: 'pie',
          labels: safeData.map((d) => d[nameKey] || ''),
          values: safeData.map((d) => d[dataKey] || 0),
          hole: 0.45,
          marker: { colors },
          textinfo: 'label+percent',
          automargin: true,
        }],
        layout: {
          ...baseLayout,
          margin: { t: 12, r: 12, b: showLegend ? 48 : 12, l: 12 },
        },
      };

    case 'scatter': {
      const xKey = config.xDataKey || 'x';
      const yKey = config.yDataKey || 'y';
      return {
        data: [{
          type: 'scatter',
          mode: 'markers',
          x: safeData.map((d) => d[xKey]),
          y: safeData.map((d) => d[yKey]),
          marker: { color: colors[0], size: 10 },
        }],
        layout: {
          ...baseLayout,
          xaxis: { title: config.xName || '', automargin: true, showgrid: !!showGrid, gridcolor: '#f3f4f6' },
          yaxis: { title: config.yName || '', automargin: true, showgrid: !!showGrid, gridcolor: '#f3f4f6' },
        },
      };
    }

    case 'radar': {
      return {
        data: [{
          type: 'scatterpolar',
          r: safeData.map((d) => d[dataKey] || 0),
          theta: safeData.map((d) => d[nameKey] || ''),
          fill: 'toself',
          line: { color: colors[0], width: 2 },
          marker: { color: colors[0] },
        }],
        layout: {
          ...baseLayout,
          polar: {
            radialaxis: { visible: true, showgrid: !!showGrid, gridcolor: '#f3f4f6' },
          },
        },
      };
    }

    case 'radialBar':
    case 'gauge': {
      const gaugeDatum = safeData[0] || {};
      const value = gaugeDatum[dataKey] || 0;
      const maxVal = Math.max(config.max || 100, value);
      return {
        data: [{
          type: 'indicator',
          mode: 'gauge+number',
          value,
          gauge: { axis: { range: [0, maxVal] }, bar: { color: colors[0] } },
        }],
        layout: {
          ...baseLayout,
          margin: { t: 24, r: 24, b: 24, l: 24 },
        },
      };
    }

    case 'composed': {
      const traces = [
        ...bars.map((b, i) => ({
          name: b.name || b.dataKey,
          type: 'bar',
          x: categoryData,
          y: safeData.map((d) => d[b.dataKey]),
          marker: { color: b.fill || colors[i % colors.length] },
        })),
        ...lines.map((l, i) => ({
          name: l.name || l.dataKey,
          type: 'scatter',
          mode: 'lines+markers',
          x: categoryData,
          y: safeData.map((d) => d[l.dataKey]),
          line: { color: l.stroke || colors[(bars.length + i) % colors.length], width: 2, shape: 'spline' },
          marker: { color: l.stroke || colors[(bars.length + i) % colors.length] },
        })),
        ...areas.map((a, i) => ({
          name: a.name || a.dataKey,
          type: 'scatter',
          mode: 'lines',
          fill: 'tozeroy',
          x: categoryData,
          y: safeData.map((d) => d[a.dataKey]),
          fillcolor: a.fill || colors[(bars.length + lines.length + i) % colors.length],
          line: { color: a.fill || colors[(bars.length + lines.length + i) % colors.length], width: 2, shape: 'spline' },
        })),
      ];
      return { data: traces, layout: { ...cartesianLayout, barmode: 'group' } };
    }

    case 'funnel':
      return {
        data: [{
          type: 'funnelarea',
          values: safeData.map((d) => d[dataKey] || 0),
          text: safeData.map((d) => d[nameKey] || ''),
          marker: { colors },
        }],
        layout: baseLayout,
      };

    case 'heatmap': {
      const xLabels = [...new Set(safeData.map((d) => d[config.xDataKey || 'x']))];
      const yLabels = [...new Set(safeData.map((d) => d[config.yDataKey || 'y']))];
      const zMatrix = yLabels.map((y) => xLabels.map((x) => {
        const match = safeData.find((d) => d[config.xDataKey || 'x'] === x && d[config.yDataKey || 'y'] === y);
        return match?.[dataKey] || 0;
      }));
      return {
        data: [{
          type: 'heatmap',
          x: xLabels,
          y: yLabels,
          z: zMatrix,
          colorscale: [[0, '#e0f2fe'], [1, '#6366f1']],
        }],
        layout: {
          ...baseLayout,
          margin: { t: 20, r: 20, b: 48, l: 60 },
        },
      };
    }

    case 'treemap':
      return {
        data: [{
          type: 'treemap',
          labels: safeData.map((d) => d[nameKey] || ''),
          parents: safeData.map(() => ''),
          values: safeData.map((d) => d[dataKey] || 0),
          marker: { colors },
          textinfo: 'label+value',
        }],
        layout: { ...baseLayout, margin: { t: 12, r: 12, b: 12, l: 12 } },
      };

    default:
      return null;
  }
}

function ChartCompiler({ chart }) {
  const { type, data, config = {} } = chart;
  const colors = config.colors || DEFAULT_COLORS;

  const safeData = useMemo(() => {
    if (!Array.isArray(data)) return [];
    return data;
  }, [data]);

  const plotSpec = useMemo(
    () => buildPlotlySpec(type, safeData, config, colors),
    [type, safeData, config, colors],
  );

  if (!safeData.length) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No data available
      </div>
    );
  }

  if (!plotSpec) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Unsupported chart type: {type}
      </div>
    );
  }

  return (
    <Plot
      data={plotSpec.data}
      layout={plotSpec.layout}
      config={{
        displayModeBar: false,
        responsive: true,
      }}
      useResizeHandler
      style={{ width: '100%', height: '100%' }}
    />
  );
}

export default memo(ChartCompiler);

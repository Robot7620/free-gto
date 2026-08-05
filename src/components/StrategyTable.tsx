import React from 'react'

export interface StrategyAction {
  action: string
  frequency: number
  ev?: number
}

interface StrategyTableProps {
  strategies: StrategyAction[]
  title?: string
}

export const StrategyTable: React.FC<StrategyTableProps> = ({ strategies, title = 'GTO Strategy' }) => {
  const total = strategies.reduce((sum, s) => sum + s.frequency, 0)

  return (
    <div className="bg-white p-4 rounded-lg shadow-md">
      <h3 className="text-lg font-semibold mb-3">{title}</h3>
      <div className="overflow-hidden border border-gray-200 rounded-lg">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Action
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                Frequency
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                %
              </th>
              {strategies.some(s => s.ev !== undefined) && (
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                  EV
                </th>
              )}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {strategies.map((strategy, idx) => {
              const percentage = total > 0 ? (strategy.frequency / total) * 100 : 0
              return (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm font-medium text-gray-900">
                    {strategy.action}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-gray-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full"
                          style={{ width: `${percentage}%` }}
                        ></div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-700">
                    {percentage.toFixed(1)}%
                  </td>
                  {strategy.ev !== undefined && (
                    <td className="px-4 py-2 text-sm text-gray-700">
                      {strategy.ev.toFixed(2)}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

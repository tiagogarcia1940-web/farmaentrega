import React, { useState } from 'react';
import { Upload, AlertCircle, Loader, RefreshCw } from 'lucide-react';
import { auth } from '../../firebase';

interface ProductImport {
  name: string;
  category: string;
  price: number;
  stock: number;
  description?: string;
  barcode?: string;
}

interface SyncReport {
  added: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

export const ImportProductsCSV: React.FC<{ pharmacyId: string }> = ({ pharmacyId }) => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [preview, setPreview] = useState<ProductImport[]>([]);

  const parseCSV = (text: string): ProductImport[] => {
    const lines = text.split('\n').filter(line => line.trim());
    const products: ProductImport[] = [];

    for (let i = 1; i < lines.length; i++) {
      const [name, category, priceStr, stockStr, description, barcode] = lines[i]
        .split(',')
        .map(value => value.trim());

      const price = Number(String(priceStr || '').replace(',', '.'));
      const stock = parseInt(String(stockStr || '0'), 10);
      if (!name || !category || Number.isNaN(price) || Number.isNaN(stock)) continue;

      products.push({
        name,
        category,
        price,
        stock,
        description: description || name,
        barcode: barcode || ''
      });
    }

    return products;
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.toLowerCase().endsWith('.csv')) {
      setError('Por favor, selecione um arquivo CSV.');
      return;
    }

    const reader = new FileReader();
    reader.onload = loadEvent => {
      try {
        const products = parseCSV(String(loadEvent.target?.result || ''));
        setPreview(products);
        setFile(selectedFile);
        setError(null);
        setReport(null);
      } catch {
        setError('Erro ao processar arquivo CSV.');
      }
    };
    reader.readAsText(selectedFile);
  };

  const handleSync = async () => {
    if (!file || preview.length === 0) {
      setError('Nenhum produto para sincronizar.');
      return;
    }

    setLoading(true);
    setError(null);
    setReport(null);

    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) throw new Error('Sessao invalida. Entre novamente.');

      const response = await fetch('/api/sync-stock', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ pharmacyId, products: preview })
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || 'Nao foi possivel sincronizar estoque.');
      }

      setReport(payload.report);
      setPreview([]);
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao sincronizar produtos.');
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    const template = `name,category,price,stock,description,barcode
Dipirona 500mg,Medicamentos,5.50,50,Analgesico e antitermico,1234567890123
Amoxicilina 500mg,Medicamentos,12.50,30,Antibiotico,1234567890124
Mascara Cirurgica,Higiene,0.50,1000,Caixa com 50 unidades,1234567890125
Alcool 70%,Higiene,5.00,100,Desinfetante,1234567890126`;

    const blob = new Blob([template], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'template-produtos.csv';
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <RefreshCw className="w-6 h-6" />
        Sincronizar Estoque via CSV
      </h2>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h3 className="font-semibold text-blue-900 mb-2">Como funciona:</h3>
        <ol className="list-decimal list-inside text-blue-800 text-sm space-y-1">
          <li>Exporte o catalogo do PCDrug ou outro sistema em CSV.</li>
          <li>Carregue o arquivo aqui e revise a previa.</li>
          <li>Produtos novos sao adicionados; existentes recebem preco e estoque atualizados.</li>
          <li>A identificacao usa codigo de barras como chave principal e nome como fallback.</li>
        </ol>
      </div>

      <button
        onClick={downloadTemplate}
        className="mb-6 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
      >
        Baixar Template CSV
      </button>

      <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center mb-6">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="hidden"
          id="csv-input"
          disabled={loading}
        />
        <label htmlFor="csv-input" className="cursor-pointer flex flex-col items-center gap-2">
          <Upload className="w-8 h-8 text-gray-400" />
          <span className="text-lg font-semibold text-gray-700">
            {file ? file.name : 'Clique para selecionar um arquivo CSV'}
          </span>
          <span className="text-sm text-gray-500">Apenas arquivos .csv</span>
        </label>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {report && (
        <div className="mb-6 rounded-lg border overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b">
            <p className="font-semibold text-gray-800">Resultado da sincronizacao</p>
          </div>
          <div className="grid grid-cols-3 divide-x">
            <div className="p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{report.added}</p>
              <p className="text-sm text-gray-600">Adicionados</p>
            </div>
            <div className="p-4 text-center">
              <p className="text-2xl font-bold text-blue-600">{report.updated}</p>
              <p className="text-sm text-gray-600">Atualizados</p>
            </div>
            <div className="p-4 text-center">
              <p className="text-2xl font-bold text-gray-500">{report.unchanged}</p>
              <p className="text-sm text-gray-600">Sem mudanca</p>
            </div>
          </div>
          {report.errors.length > 0 && (
            <div className="border-t bg-red-50 p-4">
              <p className="font-semibold text-red-800 mb-1">Erros ({report.errors.length}):</p>
              <ul className="text-sm text-red-700 space-y-0.5">
                {report.errors.map((item, index) => <li key={index}>{item}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {preview.length > 0 && (
        <div className="mb-6">
          <h3 className="font-semibold text-lg mb-3">
            Previa: {preview.length} produtos encontrados
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border p-2 text-left">Nome</th>
                  <th className="border p-2 text-left">Categoria</th>
                  <th className="border p-2 text-right">Preco</th>
                  <th className="border p-2 text-right">Estoque</th>
                  <th className="border p-2 text-left">Codigo de barras</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 5).map((product, index) => (
                  <tr key={`${product.name}-${index}`} className="hover:bg-gray-50">
                    <td className="border p-2">{product.name}</td>
                    <td className="border p-2">{product.category}</td>
                    <td className="border p-2 text-right">R$ {product.price.toFixed(2)}</td>
                    <td className="border p-2 text-right">{product.stock}</td>
                    <td className="border p-2 text-gray-500 font-mono text-xs">{product.barcode || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 5 && (
              <p className="text-gray-600 text-sm mt-2">... e mais {preview.length - 5} produtos</p>
            )}
          </div>

          <button
            onClick={handleSync}
            disabled={loading}
            className="mt-6 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Sincronizando...
              </>
            ) : (
              <>
                <RefreshCw className="w-5 h-5" />
                Sincronizar {preview.length} produtos
              </>
            )}
          </button>
        </div>
      )}

      <div className="bg-gray-50 rounded-lg p-4 mt-6">
        <h3 className="font-semibold text-gray-900 mb-2">Formato do CSV:</h3>
        <code className="block bg-white p-3 rounded border border-gray-200 text-xs font-mono overflow-x-auto">
          {`name,category,price,stock,description,barcode\nDipirona 500mg,Medicamentos,5.50,50,Analgesico,1234567890123`}
        </code>
        <p className="text-sm text-gray-600 mt-2">
          <strong>Obrigatorios:</strong> name, category, price, stock<br />
          <strong>Opcionais:</strong> description, barcode
        </p>
      </div>
    </div>
  );
};

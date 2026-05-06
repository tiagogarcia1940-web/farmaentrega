import React, { useState } from 'react';
import { Upload, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import { collection, addDoc, query, where, getDocs } from 'firebase/firestore';
import { db } from '../../firebase';

interface ProductImport {
  name: string;
  category: string;
  price: number;
  quantity: number;
  description?: string;
  barcode?: string;
}

export const ImportProductsCSV: React.FC<{ pharmacyId: string }> = ({ pharmacyId }) => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ count: number; message: string } | null>(null);
  const [preview, setPreview] = useState<ProductImport[]>([]);

  const parseCSV = (text: string): ProductImport[] => {
    const lines = text.split('\n').filter(line => line.trim());
    const products: ProductImport[] = [];

    // Espera header: name,category,price,quantity,description,barcode
    for (let i = 1; i < lines.length; i++) {
      const [name, category, priceStr, quantityStr, description, barcode] = lines[i]
        .split(',')
        .map(v => v.trim());

      if (!name || !category || !priceStr || !quantityStr) continue;

      products.push({
        name,
        category,
        price: parseFloat(priceStr),
        quantity: parseInt(quantityStr),
        description: description || '',
        barcode: barcode || ''
      });
    }

    return products;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith('.csv')) {
      setError('Por favor, selecione um arquivo CSV');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const products = parseCSV(text);
        setPreview(products);
        setFile(selectedFile);
        setError(null);
      } catch {
        setError('Erro ao processar arquivo CSV');
      }
    };
    reader.readAsText(selectedFile);
  };

  const handleImport = async () => {
    if (!file || preview.length === 0) {
      setError('Nenhum produto para importar');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      let imported = 0;

      for (const product of preview) {
        const q = query(
          collection(db, 'products'),
          where('pharmacyId', '==', pharmacyId),
          where('name', '==', product.name)
        );
        const existing = await getDocs(q);

        if (existing.empty) {
          await addDoc(collection(db, 'products'), {
            pharmacyId,
            ...product,
            createdAt: new Date(),
            updatedAt: new Date()
          });
          imported++;
        }
      }

      setSuccess({
        count: imported,
        message: `${imported} produtos importados com sucesso!`
      });
      setPreview([]);
      setFile(null);
    } catch (err) {
      setError('Erro ao importar produtos: ' + (err instanceof Error ? err.message : 'Unknown'));
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = () => {
    const template = `name,category,price,quantity,description,barcode
Dipirona 500mg,Medicamentos,5.50,50,Analgesico e antitermico,1234567890123
Amoxicilina 500mg,Medicamentos,12.50,30,Antibiotico,1234567890124
Mascara Cirurgica,Higiene,0.50,1000,Caixa com 50 unidades,1234567890125
Alcool 70%,Higiene,5.00,100,Desinfetante,1234567890126`;

    const blob = new Blob([template], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template-produtos.csv';
    a.click();
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-md">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Upload className="w-6 h-6" />
        Importar Produtos em Massa
      </h2>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <h3 className="font-semibold text-blue-900 mb-2">Como funciona:</h3>
        <ol className="list-decimal list-inside text-blue-800 text-sm space-y-1">
          <li>Baixe o template de CSV clicando no botao abaixo</li>
          <li>Abra no Excel ou Google Sheets</li>
          <li>Preencha com seus produtos: nome, categoria, preco e quantidade</li>
          <li>Salve como CSV</li>
          <li>Carregue o arquivo aqui</li>
          <li>Revise a previa e confirme a importacao</li>
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
          accept=".csv"
          onChange={handleFileChange}
          className="hidden"
          id="csv-input"
          disabled={loading}
        />
        <label
          htmlFor="csv-input"
          className="cursor-pointer flex flex-col items-center gap-2"
        >
          <Upload className="w-8 h-8 text-gray-400" />
          <span className="text-lg font-semibold text-gray-700">
            {file ? file.name : 'Clique para selecionar ou arraste um arquivo CSV'}
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

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6 flex gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <p className="text-green-800">{success.message}</p>
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
                  <th className="border p-2 text-right">Qtd</th>
                  <th className="border p-2 text-left">Descricao</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 5).map((product, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="border p-2">{product.name}</td>
                    <td className="border p-2">{product.category}</td>
                    <td className="border p-2 text-right">R$ {product.price.toFixed(2)}</td>
                    <td className="border p-2 text-right">{product.quantity}</td>
                    <td className="border p-2 text-gray-600">{product.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.length > 5 && (
              <p className="text-gray-600 text-sm mt-2">... e mais {preview.length - 5} produtos</p>
            )}
          </div>

          <button
            onClick={handleImport}
            disabled={loading}
            className="mt-6 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Importando...
              </>
            ) : (
              <>
                <CheckCircle className="w-5 h-5" />
                Importar {preview.length} Produtos
              </>
            )}
          </button>
        </div>
      )}

      <div className="bg-gray-50 rounded-lg p-4 mt-6">
        <h3 className="font-semibold text-gray-900 mb-2">Formato do CSV:</h3>
        <code className="block bg-white p-3 rounded border border-gray-200 text-xs font-mono overflow-x-auto">
          {`name,category,price,quantity,description,barcode
Dipirona 500mg,Medicamentos,5.50,50,Analgesico,1234567890123
Amoxicilina 500mg,Medicamentos,12.50,30,Antibiotico,1234567890124`}
        </code>
        <p className="text-sm text-gray-600 mt-2">
          <strong>Campos obrigatorios:</strong> name, category, price, quantity <br />
          <strong>Campos opcionais:</strong> description, barcode
        </p>
      </div>
    </div>
  );
};

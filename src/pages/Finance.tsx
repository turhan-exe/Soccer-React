import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { financeRecords } from '@/lib/data';
import { DollarSign, TrendingUp, TrendingDown, Calendar, Filter } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BackButton } from '@/components/ui/back-button';

export default function Finance() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('overview');

  const totalIncome = financeRecords
    .filter(r => r.type === 'income')
    .reduce((sum, r) => sum + r.amount, 0);
  
  const totalExpense = financeRecords
    .filter(r => r.type === 'expense')
    .reduce((sum, r) => sum + r.amount, 0);
  
  const balance = totalIncome - totalExpense + 2500000; // Starting balance

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('tr-TR', {
      style: 'currency',
      currency: 'TRY',
      minimumFractionDigits: 0
    }).format(amount);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 dark:from-green-950 dark:via-emerald-950 dark:to-teal-950">
      {/* Header */}
      <div className="bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BackButton />
            <h1 className="text-xl font-bold">Finans</h1>
          </div>
          <Button variant="outline" size="sm">
            <Filter className="h-4 w-4 mr-2" />
            Filtre
          </Button>
        </div>
      </div>

      <div className="p-4">
        {/* Balance Overview */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="text-center mb-4">
              <div className="text-3xl font-bold text-green-600 mb-2">
                {formatCurrency(balance)}
              </div>
              <div className="text-sm text-muted-foreground">Mevcut Bakiye</div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                <div className="flex items-center justify-center mb-2">
                  <TrendingUp className="h-4 w-4 text-green-600 mr-1" />
                  <span className="text-sm font-medium text-green-800 dark:text-green-200">Gelir</span>
                </div>
                <div className="font-semibold text-green-600">
                  {formatCurrency(totalIncome)}
                </div>
              </div>
              
              <div className="text-center p-3 bg-red-50 dark:bg-red-950/30 rounded-lg">
                <div className="flex items-center justify-center mb-2">
                  <TrendingDown className="h-4 w-4 text-red-600 mr-1" />
                  <span className="text-sm font-medium text-red-800 dark:text-red-200">Gider</span>
                </div>
                <div className="font-semibold text-red-600">
                  {formatCurrency(totalExpense)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Chart Placeholder */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Aylık Gelir-Gider Grafiği
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-gradient-to-r from-blue-100 to-purple-100 dark:from-blue-950 to-purple-950 rounded-lg p-8 text-center">
              <div className="text-4xl mb-4">📊</div>
              <div className="font-semibold mb-2">Grafik Görünümü</div>
              <div className="text-sm text-muted-foreground">
                Son 12 ayın gelir-gider dağılımı burada görüntülenecek
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Transaction History */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">Tümü</TabsTrigger>
            <TabsTrigger value="income">Gelir</TabsTrigger>
            <TabsTrigger value="expense">Gider</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Son İşlemler</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {financeRecords.map(record => (
                    <div key={record.id} className="flex items-center justify-between p-3 bg-muted rounded-lg">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          record.type === 'income' ? 'bg-green-100 dark:bg-green-950' : 'bg-red-100 dark:bg-red-950'
                        }`}>
                          {record.type === 'income' ? 
                            <TrendingUp className="h-5 w-5 text-green-600" /> : 
                            <TrendingDown className="h-5 w-5 text-red-600" />
                          }
                        </div>
                        <div>
                          <div className="font-medium">{record.category}</div>
                          <div className="text-sm text-muted-foreground">{record.description}</div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(record.date).toLocaleDateString('tr-TR')}
                          </div>
                        </div>
                      </div>
                      <div className={`font-semibold ${
                        record.type === 'income' ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {record.type === 'income' ? '+' : '-'}{formatCurrency(record.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="income" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-green-600" />
                  Gelir Kalemleri
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {financeRecords.filter(r => r.type === 'income').map(record => (
                    <div key={record.id} className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950/30 rounded-lg">
                      <div>
                        <div className="font-medium">{record.category}</div>
                        <div className="text-sm text-muted-foreground">{record.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(record.date).toLocaleDateString('tr-TR')}
                        </div>
                      </div>
                      <div className="font-semibold text-green-600">
                        +{formatCurrency(record.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="expense" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-red-600" />
                  Gider Kalemleri
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {financeRecords.filter(r => r.type === 'expense').map(record => (
                    <div key={record.id} className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-950/30 rounded-lg">
                      <div>
                        <div className="font-medium">{record.category}</div>
                        <div className="text-sm text-muted-foreground">{record.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(record.date).toLocaleDateString('tr-TR')}
                        </div>
                      </div>
                      <div className="font-semibold text-red-600">
                        -{formatCurrency(record.amount)}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Quick Actions */}
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Hızlı İşlemler</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="h-12">
                Sponsorluk Anlaşması
              </Button>
              <Button variant="outline" className="h-12">
                Oyuncu Satışı
              </Button>
              <Button variant="outline" className="h-12">
                Stadyum Geliştirme
              </Button>
              <Button variant="outline" className="h-12">
                Kredi Başvurusu
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}